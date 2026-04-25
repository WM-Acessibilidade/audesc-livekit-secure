# Audesc LiveKit Server Controlado v4

Esta versão mantém a expiração real por uso e altera a regra de acesso:

- audiodescritor(a) / transmissor: precisa informar a senha do evento;
- ouvintes: entram sem senha, usando apenas o código da sala ou link da sala.

## Como funciona

1. O transmissor entra com uma senha válida.
2. Se a senha for de uso único, o backend registra o primeiro uso e a sala escolhida.
3. A senha passa a valer pelo tempo do pacote. Exemplo: P20H2 = 2 horas.
4. Ouvintes entram pelo código da sala sem precisar digitar senha.
5. O backend reconhece a sala usada pelo transmissor e libera os ouvintes enquanto a senha/sessão estiver válida.

## Arquivos

Substitua no repositório do backend:

- server.js
- package.json
- permissions.json
- README.md

Depois faça Manual Deploy no Render.

## Configuração relevante

No permissions.json:

```json
"permitirSemSenha": false,
"permitirOuvinteSemSenha": true
```

Assim, o transmissor precisa de senha, mas o ouvinte não.

## Observação sobre persistência

No Render Free, o arquivo `usage-state.json`, que registra o primeiro uso das senhas, pode ser perdido em reinícios ou redeploys. Para uso comercial definitivo, o ideal será migrar esse controle para banco de dados, Google Sheets, Supabase ou outro armazenamento persistente.
