CREATE INDEX "wiki_articles_search_idx" ON "wiki_articles" USING gin ((
        setweight(to_tsvector('english', "title"), 'A') ||
        setweight(to_tsvector('english', coalesce("excerpt", '')), 'B') ||
        setweight(to_tsvector('english', "content"), 'C')
      ));