# Segurança e privacidade

Este documento registra os controles implementados no MVP e os requisitos para
colocá-lo em um ambiente compartilhado ou de produção. Ele não é uma
certificação de conformidade com a LGPD nem substitui a análise jurídica,
contratual e organizacional da BlueCat.

## Controles implementados

- O PostgreSQL usa o papel `bluecat_api` para a aplicação e
  `bluecat_migrator` somente para migrações. As tabelas do domínio têm
  Row-Level Security habilitado e são de propriedade do migrador.
- A tabela de solicitações de acesso aceita somente inserções públicas de novos
  pedidos pendentes. Consulta, aprovação e rejeição são exclusivas do
  `PLATFORM_ADMIN`; a senha temporária é gerada no backend e não é armazenada
  em texto puro.
- A autorização é feita no servidor, por rota e também nos serviços. O
  `PLATFORM_ADMIN` administra empresas, usuários, categorias, permissões e
  conteúdos; clientes recebem somente artigos publicados em categorias
  liberadas para sua empresa.
- Consultas de artigos e categorias são escopadas pela empresa e pelas
  permissões. A leitura de um artigo por ID não ignora esse escopo.
- A sessão web usa cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção.
  O navegador não persiste JWT em `localStorage`.
- A API aplica CORS por allowlist, verificação de `Origin` para mutações,
  cabeçalhos de segurança via Helmet, CSP, limitação de requisições e
  validação estrita de DTOs.
- Conteúdo exibido no frontend é escapado antes de entrar em HTML. URLs de
  vídeo são validadas no backend e convertidas para o host controlado do
  YouTube.
- IDs de rota são validados como UUID e entradas textuais são limitadas,
  normalizadas e rejeitadas quando vazias.
- Senhas são armazenadas somente como hash bcrypt. Segredos e senhas do seed
  são lidos do ambiente e não ficam no código-fonte.

## Requisitos antes da produção

1. Trocar o `JWT_SECRET`, as senhas do banco e todas as credenciais de teste.
   Como credenciais de desenvolvimento foram compartilhadas durante a
   configuração, elas devem ser consideradas expostas e rotacionadas.
2. Usar HTTPS terminado em um proxy confiável, configurar `NODE_ENV=production`
   e definir `FRONTEND_ORIGINS` somente com origens reais e necessárias.
3. Guardar segredos em um gerenciador de segredos da infraestrutura; não
   colocar `.env`, dumps do banco, cookies ou logs com credenciais no Git ou
   em artefatos de CI.
4. Remover usuários, empresas e senhas demo antes do primeiro deploy público.
   Configurar backup criptografado, restauração testada, retenção e controle
   de acesso ao banco.
5. Adicionar MFA para administradores, auditoria de ações administrativas,
   monitoramento de login/erro/alteração de permissão e alertas para abuso.
6. Executar SAST, DAST, varredura de dependências e teste de autorização no
   pipeline. O `npm audit` atual ainda reporta vulnerabilidades transitivas
   ligadas ao Prisma CLI; atualizar o Prisma de forma planejada e validada
   antes do release.
7. Formalizar inventário de dados pessoais, finalidade e retenção, aviso de
   privacidade, contratos com operadores e procedimento para titulares. A
   equipe deve definir responsáveis e prazos para incidentes.

## Incidentes

Preservar evidências, conter o acesso, rotacionar credenciais comprometidas,
avaliar risco e registrar a linha do tempo. Quando houver incidente de
segurança com risco ou dano relevante aos titulares, a comunicação à ANPD e
aos titulares deve seguir a regulamentação aplicável e o canal oficial da
ANPD, incluindo o prazo de três dias úteis indicado na página de comunicação
de incidentes.

## Referências técnicas

- [Guia de segurança da informação para agentes de tratamento de pequeno porte — ANPD](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/anonimizado___guia_orientat-_seg_da_inf_p_atpp.pdf)
- [Comunicação de incidente de segurança — ANPD](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis?sck=direto)
- [Authorization Cheat Sheet — OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [Insecure Direct Object Reference Prevention — OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html)
- [Cross Site Scripting Prevention — OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [Secrets Management — OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
