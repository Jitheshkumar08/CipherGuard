-- CipherGuard V2 PostgreSQL Schema
-- Copy and paste this into your real PostgreSQL database (Supabase, Neon, Render, etc.)

-- 1. Enable UUID generation 
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Create Users Table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    encrypted_dek TEXT NOT NULL,
    dek_iv VARCHAR(255) NOT NULL,
    kek_salt VARCHAR(255) NOT NULL,
    encrypted_private_key TEXT NOT NULL,
    public_key TEXT NOT NULL,
    rsa_iv VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Create Encrypted Files Table
CREATE TABLE encrypted_files (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    original_name VARCHAR(255) NOT NULL,
    stored_name VARCHAR(255) NOT NULL UNIQUE,
    mime_type VARCHAR(100),
    file_size BIGINT NOT NULL,
    encryption_meta JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create an index to quickly load files for the authenticated user
CREATE INDEX idx_encrypted_files_user_id ON encrypted_files(user_id);

select * from users
select * from encrypted_files


