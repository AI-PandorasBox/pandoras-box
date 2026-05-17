# offline-kb -- Requirements

| Requirement | Value |
|-------------|-------|
| core | Required |
| Qdrant | Local Docker container or native install |
| ollama | Recommended (for embedding generation without API cost) |
| Documents | .txt, .md, or .pdf files to index |

## Qdrant via Docker

```
docker run -d --name qdrant -p 6333:6333 \
  -v ~/.qdrant:/qdrant/storage \
  qdrant/qdrant:latest
```
