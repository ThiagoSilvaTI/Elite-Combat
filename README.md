# Elite Combat

## Banco de dados no Render

O desenvolvimento local usa SQLite em `database/elite_combat.db`. No Render,
configure o banco Turso para que inscrições, feedbacks e contratos permaneçam
disponíveis após reinicializações e deploys.

1. Crie um banco no Turso e gere uma URL e um token de autenticação.
2. Antes de trocar o banco usado pelo Render, baixe um backup pelo painel
   administrativo atual. O backup inclui inscrições, feedbacks e contratos
   armazenados no banco.
3. Configure estas variáveis no serviço do Render:
   - `DATABASE_PROVIDER=turso`
   - `TURSO_DATABASE_URL=<URL do banco>`
   - `TURSO_AUTH_TOKEN=<token de autenticação>`
4. Faça o deploy e importe o arquivo de backup pelo painel administrativo.

O servidor não inicia no Render se o provedor ou as credenciais do Turso
estiverem ausentes. Não aponte a aplicação para um banco Turso vazio antes de
baixar o backup da produção. Para consultar os dados via CLI, use
`turso db shell <nome-do-banco>`.

Mantenha backups fora do serviço do Render. A disponibilidade de qualquer
plano gratuito depende dos termos atuais do provedor.

teste de envio