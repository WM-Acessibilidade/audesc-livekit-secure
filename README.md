# Audesc LiveKit Server com Google Sheets

Backend com controle por planilha Google.

Regra:
- transmissor usa senha;
- ouvinte entra sem senha, apenas com sala/link;
- primeira entrada do transmissor grava `iniciadoEm` e `salaAtivada`;
- duração conta pela coluna `horas`.

Variáveis no Render:
- LIVEKIT_API_KEY
- LIVEKIT_API_SECRET
- GOOGLE_SHEET_ID
- GOOGLE_CLIENT_EMAIL
- GOOGLE_PRIVATE_KEY
- SHEET_NAME = eventos
- ADMIN_PASSWORD

A planilha deve ter uma aba chamada `eventos`.
Importe `modelo_eventos_google_sheets.csv` para criar as colunas e 200 senhas demo.
Compartilhe a planilha com o e-mail da conta de serviço (`GOOGLE_CLIENT_EMAIL`) como Editor.
