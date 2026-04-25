const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { AccessToken } = require('livekit-server-sdk');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const CONFIG_PATH = path.join(__dirname, 'permissions.json');

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeRoom(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
}

function parseDateMs(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function findEventByPassword(config, password) {
  const senha = normalizeText(password);
  return (config.eventos || []).find(ev => normalizeText(ev.senha) === senha);
}

function findEventByRoom(config, room) {
  const target = normalizeRoom(room);
  return (config.eventos || []).find(ev => normalizeRoom(ev.sala) === target);
}

function getPackageById(config, packageId) {
  return (config.pacotes || []).find(pkg => normalizeText(pkg.id) === normalizeText(packageId));
}

function calculatePackageValue(pkg, config) {
  const valorPorOuvinteHora = Number(config.valorPorOuvinteHora || 10);
  return Number(pkg.maxOuvintes || 0) * valorPorOuvinteHora * Number(pkg.horas || 0);
}

function validateEventSchedule(event, pkg) {
  const current = Date.now();
  const inicioMs = parseDateMs(event.inicio);
  const fimMs = parseDateMs(event.fim);

  if (inicioMs && current < inicioMs) {
    return { ok: false, status: 403, error: 'Transmissão ainda não liberada para este evento.' };
  }
  if (fimMs && current > fimMs) {
    return { ok: false, status: 403, error: 'Horário de transmissão encerrado para este evento.' };
  }

  if (event.iniciadoEm && pkg && pkg.horas) {
    const limiteMs = Number(event.iniciadoEm) + Number(pkg.horas) * 60 * 60 * 1000;
    if (current > limiteMs) {
      return { ok: false, status: 403, error: 'Duração contratada do pacote encerrada.' };
    }
  }

  return { ok: true };
}

function getTokenTtlSeconds(event, pkg, isAdmin) {
  if (isAdmin) return 8 * 60 * 60;

  const current = Date.now();
  let ttl = 60 * 60;

  const fimMs = parseDateMs(event.fim);
  if (fimMs) ttl = Math.max(60, Math.floor((fimMs - current) / 1000));

  if (event.iniciadoEm && pkg && pkg.horas) {
    const limiteMs = Number(event.iniciadoEm) + Number(pkg.horas) * 60 * 60 * 1000;
    const packageTtl = Math.max(60, Math.floor((limiteMs - current) / 1000));
    ttl = Math.min(ttl, packageTtl);
  }

  return Math.min(ttl, 8 * 60 * 60);
}

async function makeToken(room, identity, role, ttlSeconds) {
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    throw new Error('LIVEKIT_API_KEY e LIVEKIT_API_SECRET precisam estar configurados.');
  }

  const canPublish = role === 'transmitter';

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    ttl: ttlSeconds
  });

  at.addGrant({
    room,
    roomJoin: true,
    canSubscribe: true,
    canPublish,
    canPublishData: true
  });

  return await at.toJwt();
}

app.get('/token', async (req, res) => {
  try {
    const config = loadConfig();

    const role = normalizeText(req.query.role) === 'transmitter' ? 'transmitter' : 'receiver';
    const identity = normalizeText(req.query.identity) || (role === 'transmitter' ? 'audiodescritor' : 'ouvinte');
    const roomFromQuery = normalizeRoom(req.query.room);
    const password = normalizeText(req.query.password);

    const isAdmin = password && password === normalizeText(config.senhaGeral);

    if (isAdmin) {
      const room = roomFromQuery || 'audesc-admin';
      const ttlSeconds = 8 * 60 * 60;
      return res.json({
        token: await makeToken(room, identity, role, ttlSeconds),
        room,
        identity,
        role,
        acesso: 'admin',
        ttlSeconds
      });
    }

    const event = password ? findEventByPassword(config, password) : findEventByRoom(config, roomFromQuery);

    if (!event) {
      if (!config.permitirSemSenha) {
        return res.status(403).json({ error: 'Senha, sala ou evento não autorizado.' });
      }

      const room = roomFromQuery || 'audesc-livre';
      const ttlSeconds = 60 * 60;
      return res.json({
        token: await makeToken(room, identity, role, ttlSeconds),
        room,
        identity,
        role,
        acesso: 'livre-temporario',
        ttlSeconds,
        aviso: 'Acesso sem senha liberado porque permitirSemSenha está ativado.'
      });
    }

    if (normalizeText(event.status || 'ativo') !== 'ativo') {
      return res.status(403).json({ error: 'Evento não está ativo.' });
    }

    const pkg = getPackageById(config, event.pacote);
    if (!pkg) return res.status(403).json({ error: 'Pacote do evento não encontrado.' });

    const schedule = validateEventSchedule(event, pkg);
    if (!schedule.ok) return res.status(schedule.status).json({ error: schedule.error });

    const room = normalizeRoom(event.sala || roomFromQuery);
    if (!room) return res.status(400).json({ error: 'Sala não definida para o evento.' });

    if (roomFromQuery && roomFromQuery !== room) {
      return res.status(403).json({ error: 'Esta senha não autoriza a sala solicitada.' });
    }

    const ttlSeconds = getTokenTtlSeconds(event, pkg, false);

    return res.json({
      token: await makeToken(room, identity, role, ttlSeconds),
      room,
      identity,
      role,
      acesso: 'evento',
      evento: event.nome,
      pacote: event.pacote,
      maxOuvintes: pkg.maxOuvintes,
      horas: pkg.horas,
      valorEstimado: calculatePackageValue(pkg, config),
      ttlSeconds
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Erro interno ao gerar token.' });
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'audesc-livekit-server-controlado', version: 'v2-async-token' });
});

app.get('/config-publica', (req, res) => {
  try {
    const config = loadConfig();
    const pacotes = (config.pacotes || []).map(pkg => ({
      id: pkg.id,
      maxOuvintes: pkg.maxOuvintes,
      horas: pkg.horas,
      valor: calculatePackageValue(pkg, config)
    }));
    res.json({ ok: true, valorPorOuvinteHora: config.valorPorOuvinteHora || 10, pacotes });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao carregar configuração pública.' });
  }
});

app.listen(PORT, () => {
  console.log(`Audesc backend controlado rodando na porta ${PORT}`);
});
