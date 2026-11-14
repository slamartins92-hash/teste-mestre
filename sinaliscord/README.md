# Sinaliscord (beta)

Site privado sinais escarlate.

## Hospedagem no Render

- Node 20+
- Build: `npm install`
- Start: `npm start`
- Variáveis: `DATABASE_URL` (Postgres) e `SINALIS_SEED_HASHES` (JSON dos hashes PBKDF2 das cinco contas, configurados apenas no Render)
- Rota de saúde: `/api/health`

A hospedagem gratuita do Render entra em hibernação e o Postgres gratuito expira em 30 dias. Para manter dados permanentemente, migrar para um armazenamento durável antes do vencimento.

Contas: Pingu (Mestre), Knight, Manuela, Mafe, Luska (Players). Cadastro fechado na versão beta.