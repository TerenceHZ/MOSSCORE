# MOSS CORE official site

Static one-page site for MOSS CORE, in the 550C black/gold terminal language.

## Local preview

```powershell
python -m http.server 8899 --bind 127.0.0.1 --directory D:\数据库\website
```

Open `http://127.0.0.1:8899/`.

## Production

The live Caddy route is in `cloud/Caddyfile`:

- `/` → `/var/www/moss-site`
- `/snapshot`, `/license/*`, `/admin*`, `/health` → collector on `127.0.0.1:8787`

The desktop installer in `downloads/` is not committed. Deploy the current versioned ZIP separately when publishing a release.

## Mobile H5 preview

`/m/` is a mobile-first 550C preview with simulated feed data. It is installable to the home screen via `m/manifest.json`.

```text
https://43-160-232-254.sslip.io/m/
```
