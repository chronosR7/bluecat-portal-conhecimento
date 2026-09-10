# PostgreSQL no Fedora KDE

O KDE não altera a instalação do PostgreSQL: os comandos são executados no Konsole usando `dnf` e `systemctl`.

## 1. Instalar o servidor

```bash
sudo dnf install postgresql-server postgresql-contrib
```

Inicialize o cluster e ative o serviço:

```bash
sudo postgresql-setup --initdb --unit postgresql
sudo systemctl enable --now postgresql
sudo systemctl status postgresql
```

Se a sua versão do pacote oferecer outro nome para o utilitário de inicialização, confira com:

```bash
dnf provides '*/postgresql-setup'
```

## 2. Criar os usuários e o banco da aplicação

Abra o cliente como o usuário administrativo do PostgreSQL:

```bash
sudo -u postgres psql
```

Crie os papéis separadamente. Quando usar \password, execute somente esse
comando e conclua a senha antes de colar o próximo comando:

```sql
CREATE ROLE bluecat_migrator LOGIN;
\password bluecat_migrator
CREATE ROLE bluecat_api LOGIN;
\password bluecat_api
CREATE DATABASE bluecat_knowledge OWNER bluecat_migrator;
\q
```

Para conferir a conexão:

```bash
psql -h 127.0.0.1 -U bluecat_migrator -d bluecat_knowledge -W
psql -h 127.0.0.1 -U bluecat_api -d bluecat_knowledge -W
```

## 3. Configurar a API

Na raiz do projeto:

```bash
cp .env.example .env
```

Edite `DATABASE_URL` no `.env`:

```env
DATABASE_URL="postgresql://bluecat_api:SENHA_DO_API@127.0.0.1:5432/bluecat_knowledge?schema=public"
```

Se a senha tiver caracteres como `@`, `#`, `/`, `:` ou espaços, faça URL encode antes de colocá-la na URL de conexão.

## 4. Criar as tabelas e dados iniciais

```bash
cp .env.example .env.migrator
# Edite .env.migrator e informe DATABASE_URL com bluecat_migrator.
# Informe também SEED_PLATFORM_PASSWORD e SEED_CLIENT_PASSWORD.
PRISMA_ENV_FILE=.env.migrator npm run prisma:deploy
PRISMA_ENV_FILE=.env.migrator npm run prisma:seed
```

O Prisma aplicará o schema e as policies de RLS. Quando o schema mudar durante
o desenvolvimento, use o mesmo `PRISMA_ENV_FILE` com
`npm run prisma:migrate -- --name descreva-a-mudanca`.

Para abrir um painel local de inspeção:

```bash
npm run db:studio
```

## 5. Diagnóstico rápido

```bash
systemctl is-active postgresql
ss -ltnp | grep 5432
psql -h 127.0.0.1 -U bluecat_api -d bluecat_knowledge -W -c 'SELECT version();'
```

Se o serviço estiver ativo, mas a conexão falhar, verifique o usuário, a senha, o nome do banco e a porta. Para o desenvolvimento local, não é necessário abrir a porta 5432 no firewall; a API e o banco estão na mesma máquina.

## Referências oficiais

- [Fedora Docs — PostgreSQL](https://docs.fedoraproject.org/en-US/quick-docs/postgresql/)
- [NestJS — Prisma](https://docs.nestjs.com/recipes/prisma)
- [Prisma — PostgreSQL](https://www.prisma.io/docs/orm/overview/databases/postgresql)
