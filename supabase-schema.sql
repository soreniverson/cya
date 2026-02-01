-- =============================================
-- Can You Imagine - Database Schema
-- Run this in Supabase SQL Editor
-- =============================================

-- Concepts table
CREATE TABLE concepts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  caption TEXT,
  image_url TEXT NOT NULL,
  image_width INT DEFAULT 1080,
  image_height INT DEFAULT 1080,
  category TEXT,
  date_posted DATE,
  is_published BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Full-text search vector
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(caption, '') || ' ' || coalesce(category, ''))
  ) STORED
);

-- Indexes for performance
CREATE INDEX idx_concepts_category ON concepts (category);
CREATE INDEX idx_concepts_date_posted ON concepts (date_posted DESC);
CREATE INDEX idx_concepts_search ON concepts USING GIN (search_vector);
CREATE INDEX idx_concepts_published ON concepts (is_published) WHERE is_published = true;
CREATE INDEX idx_concepts_slug ON concepts (slug);

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER concepts_updated_at
  BEFORE UPDATE ON concepts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- =============================================
-- Row Level Security (RLS)
-- =============================================

ALTER TABLE concepts ENABLE ROW LEVEL SECURITY;

-- Public can view published concepts
CREATE POLICY "Public can view published concepts"
  ON concepts FOR SELECT
  USING (is_published = true);

-- Authenticated users (admin) have full access
CREATE POLICY "Admin full access"
  ON concepts FOR ALL
  USING (auth.role() = 'authenticated');

-- =============================================
-- Storage Bucket for Images
-- =============================================

-- Create the storage bucket (run this separately in Supabase dashboard or via API)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('concepts', 'concepts', true);

-- Storage policies for the concepts bucket
-- Public read access
CREATE POLICY "Public can view concept images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'concepts');

-- Authenticated users can upload
CREATE POLICY "Admin can upload concept images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'concepts' AND auth.role() = 'authenticated');

-- Authenticated users can update
CREATE POLICY "Admin can update concept images"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'concepts' AND auth.role() = 'authenticated');

-- Authenticated users can delete
CREATE POLICY "Admin can delete concept images"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'concepts' AND auth.role() = 'authenticated');

-- =============================================
-- Helper function for generating slugs
-- =============================================

CREATE OR REPLACE FUNCTION generate_slug(category_val TEXT, title_val TEXT)
RETURNS TEXT AS $$
DECLARE
  base_slug TEXT;
  final_slug TEXT;
  counter INT := 0;
BEGIN
  -- Create base slug from category/title
  base_slug := lower(
    regexp_replace(
      regexp_replace(
        coalesce(category_val, 'concept') || '/' || coalesce(title_val, 'untitled'),
        '[^a-zA-Z0-9/]+', '-', 'g'
      ),
      '-+', '-', 'g'
    )
  );
  base_slug := trim(both '-' from base_slug);

  final_slug := base_slug;

  -- Check for uniqueness and append number if needed
  WHILE EXISTS (SELECT 1 FROM concepts WHERE slug = final_slug) LOOP
    counter := counter + 1;
    final_slug := base_slug || '-' || counter;
  END LOOP;

  RETURN final_slug;
END;
$$ LANGUAGE plpgsql;
