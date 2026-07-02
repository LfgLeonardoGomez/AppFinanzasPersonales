# c-19-fix-dev-setup

Fix two dev-environment bugs: Rollup native binary mismatch in web container (remove host node_modules bind-mount) and missing automatic DB migrations (run alembic upgrade head on api start). End-to-end test: docker compose up -d brings all 3 services healthy.
