-- Script de inicialização do PostgreSQL
-- Executado automaticamente quando o container sobe pela primeira vez

-- Criar extensões úteis
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- busca por similaridade de texto
CREATE EXTENSION IF NOT EXISTS "unaccent";  -- busca sem acentos

-- Configurar timezone
SET timezone = 'America/Sao_Paulo';

-- Log de inicialização
DO $$ BEGIN
  RAISE NOTICE 'MontaRapido DB inicializado em %', NOW();
END $$;
