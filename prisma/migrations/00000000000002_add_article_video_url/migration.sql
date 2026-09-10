-- Adiciona o link opcional de vídeo exibido no leitor de artigos.
ALTER TABLE "Article"
ADD COLUMN "videoUrl" TEXT;
