# Audesc LiveKit Server Controlado v2

Versão corrigida: `toJwt()` é usado com `await`.

Se o endpoint `/token` retorna `"token": {}`, o LiveKit acusa `invalid authorization token`.
Nesta versão, o campo `token` retorna uma string JWT válida.

## Render

Variáveis necessárias:

- LIVEKIT_API_KEY
- LIVEKIT_API_SECRET

Depois de subir os arquivos no GitHub, faça Manual Deploy no Render.
