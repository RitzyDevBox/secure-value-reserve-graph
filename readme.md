### Deployment Info

graph codegen
graph build

Make sure you have a .env in the file

GOLDSKY_API_KEY=sk_live_XXXXXXXX
GOLDSKY_PROJECT_ID=your-project-id

export $(grep -v '^#' .env | xargs)


goldsky subgraph delete secure-value-reserve/1.0.0

goldsky subgraph deploy secure-value-reserve/1.0.1 --token $GOLDSKY_API_KEY