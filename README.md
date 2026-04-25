# Audesc LiveKit Server Controlado

Backend de teste para gerar tokens LiveKit com controle de acesso, sem mexer no backend atual.

## Variáveis de ambiente no Render

Configure:

- LIVEKIT_API_KEY
- LIVEKIT_API_SECRET

## Teste rápido

- `/health`
- `/token?room=audesc-evento-teste&identity=Leonardo&role=transmitter&password=EVENTO-TESTE`

## Arquivo de permissões

Edite `permissions.json`.

Campos principais:

- `senhaGeral`: acesso irrestrito.
- `permitirSemSenha`: deixe `true` em testes; em produção controlada, use `false`.
- `valorPorOuvinteHora`: valor-base.
- `pacotes`: combinações de ouvintes e horas.
- `eventos`: eventos autorizados.

## Fórmula de valor

valor = maxOuvintes × valorPorOuvinteHora × horas

Exemplo: 20 ouvintes × R$10 × 2 horas = R$400.

## Como testar sem risco

Crie outro repositório no GitHub, publique este backend em outro serviço Render e teste trocando apenas o `tokenEndpoint` do `live/livekit-config.js`.

Para voltar ao backend antigo, restaure o endpoint anterior.
