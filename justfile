[private]
just:
    just -l

# Clean sources
[group('build')]
c:
    rm -rf dist

# Build sources
[group('build')]
b:
    npm run build

# Rebuild
[group('build')]
rb:
    just c & just b

# Run in debug mode
[group('run')]
r:
    PORT=3001 npm run dev

# Deploy docker container
[group('docker')]
d:
    docker compose up -d --build

# Deploy docker container (force)
[group('docker')]
dc:
  docker compose build --no-cache --pull
  docker compose up -d --force-recreate

# Stop docker container
[group('docker')]
s:
    docker compose stop

[group('manage')]
reinstall:
    rm -rf node_modules package-lock.json
    npm install
