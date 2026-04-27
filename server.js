const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const SHEET_NAME = process.env.SHEET_NAME || 'eventos';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'AUDESC-ADMIN';

function txt(v){ return String(v || '').trim(); }
function roomNorm(v){ return txt(v).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, ''); }
function parseMs(v){ const t = Date.parse(v || ''); return Number.isNaN(t) ? null : t; }
function iso(){ return new Date().toISOString(); }

async function sheetsClient(){
  if(!GOOGLE_SHEET_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    throw new Error('Variáveis do Google Sheets não configuradas.');
  }
  const auth = new google.auth.JWT({
    email: GOOGLE_CLIENT_EMAIL,
    key: GOOGLE_PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({version:'v4', auth});
}

async function readEvents(){
  const sheets = await sheetsClient();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A1:N`
  });
  const values = resp.data.values || [];
  if(!values.length) return [];
  const headers = values[0].map(txt);
  return values.slice(1).map((row, idx) => {
    const ev = {_rowNumber: idx + 2};
    headers.forEach((h, i) => ev[h] = row[i] || '');
    return ev;
  });
}

async function updateCell(row, col, value){
  const sheets = await sheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!${col}${row}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[value]] }
  });
}

function findByPassword(events, password){ return events.find(e => txt(e.senha) === txt(password)); }
function findByRoom(events, room){
  const r = roomNorm(room);
  return events.find(e => roomNorm(e.sala) === r || roomNorm(e.salaAtivada) === r);
}

function checkEvent(ev){
  if(txt(ev.status).toLowerCase() !== 'ativo') return {ok:false, error:'Evento ou senha inativo.'};
  const now = Date.now();
  const ini = parseMs(ev.inicio);
  const fim = parseMs(ev.fim);
  if(ini && now < ini) return {ok:false, error:'Transmissão ainda não liberada.'};
  if(fim && now > fim) return {ok:false, error:'Validade encerrada.'};
  if(txt(ev.usoUnico).toLowerCase() === 'sim' && ev.iniciadoEm){
    const started = parseMs(ev.iniciadoEm);
    const exp = started + Number(ev.horas || 0) * 60 * 60 * 1000;
    if(now > exp) return {ok:false, error:'Senha expirada. O prazo de uso terminou.'};
  }
  return {ok:true};
}

function ttlFor(ev){
  const now = Date.now();
  let ttl = 60 * 60;
  const fim = parseMs(ev.fim);
  if(fim) ttl = Math.max(60, Math.floor((fim - now)/1000));
  if(txt(ev.usoUnico).toLowerCase() === 'sim' && ev.iniciadoEm){
    const exp = parseMs(ev.iniciadoEm) + Number(ev.horas || 0) * 60 * 60 * 1000;
    ttl = Math.min(ttl, Math.max(60, Math.floor((exp - now)/1000)));
  }
  return Math.min(ttl, 8 * 60 * 60);
}


async function removerTransmissoresAtivos(room) {
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !room) {
    return { removidos: 0, motivo: 'LIVEKIT_URL não configurado ou sala ausente.' };
  }
  try {
    const svc = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    const participantes = await svc.listParticipants(room);
    let removidos = 0;
    for (const p of participantes) {
      const tracks = p.tracks || [];
      const publicaAudio = tracks.some(t => {
        const type = String(t.type || t.source || '').toLowerCase();
        return type.includes('audio') || type.includes('microphone');
      });
      if (publicaAudio) {
        await svc.removeParticipant(room, p.identity);
        removidos++;
      }
    }
    return { removidos };
  } catch (e) {
    console.error('Falha ao remover transmissor ativo:', e);
    return { removidos: 0, erro: e.message || 'Falha ao remover transmissor ativo.' };
  }
}

async function token(room, identity, role, ttl){
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {identity, ttl});
  at.addGrant({room, roomJoin:true, canSubscribe:true, canPublish: role === 'transmitter', canPublishData:true});
  return await at.toJwt();
}

app.get('/token', async (req, res) => {
  try{
    const role = txt(req.query.role) === 'transmitter' ? 'transmitter' : 'receiver';
    const identity = txt(req.query.identity) || (role === 'transmitter' ? 'audiodescritor' : 'ouvinte');
    const password = txt(req.query.password);
    const requestedRoom = roomNorm(req.query.room);

    if(password && password === ADMIN_PASSWORD){
      const room = requestedRoom || 'audesc-admin';
      let adminOverride = null;
      if (role === 'transmitter') {
        adminOverride = await removerTransmissoresAtivos(room);
      }
      return res.json({token: await token(room, identity, role, 8*60*60), room, identity, role, acesso:'admin', adminOverride});
    }

    const events = await readEvents();
    let ev = null;

    if(role === 'transmitter'){
      ev = findByPassword(events, password);
      if(!ev) return res.status(403).json({error:'Senha inválida para audiodescritor(a).'});
    } else {
      ev = findByRoom(events, requestedRoom);
      if(!ev) return res.status(403).json({error:'Sala ainda não iniciada pelo audiodescritor(a), ou código inválido.'});
    }

    const ok = checkEvent(ev);
    if(!ok.ok) return res.status(403).json({error: ok.error});

    let room = roomNorm(ev.sala || ev.salaAtivada || requestedRoom);
    if(role === 'transmitter'){
      if(ev.sala && requestedRoom && requestedRoom !== roomNorm(ev.sala)){
        return res.status(403).json({error:'Esta senha não autoriza a sala solicitada.'});
      }
      if(!room) room = requestedRoom;
      if(!room) return res.status(400).json({error:'Informe o código da sala.'});

      if(!ev.iniciadoEm) await updateCell(ev._rowNumber, 'K', iso());
      await updateCell(ev._rowNumber, 'L', room);
      await updateCell(ev._rowNumber, 'M', identity);
      await updateCell(ev._rowNumber, 'N', iso());
      ev.iniciadoEm = ev.iniciadoEm || iso();
      ev.salaAtivada = room;
    }

    const ttl = ttlFor(ev);
    return res.json({
      token: await token(room, identity, role, ttl),
      room, identity, role,
      evento: ev.nomeEvento || '',
      maxOuvintes: Number(ev.maxOuvintes || 0),
      horas: Number(ev.horas || 0),
      ttlSeconds: ttl
    });
  } catch(e){
    console.error(e);
    res.status(500).json({error:e.message || 'Erro interno.'});
  }
});

app.get('/health', (req,res)=>res.json({ok:true, service:'audesc-livekit-server-sheets', version:'sheets-v2-admin-assumir'}));

app.listen(PORT, () => console.log(`Audesc Sheets backend rodando na porta ${PORT}`));
