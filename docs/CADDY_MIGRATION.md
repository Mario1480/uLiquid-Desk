# Caddy Migration: Snap -> apt + systemd

## Ziel

Snap-Caddy vollständig entfernen und auf das offizielle Caddy-Paket aus dem apt-Repo umstellen.

Neuer Standard:
- Paketquelle: offizielles Caddy apt-Repo
- Config: `/etc/caddy/Caddyfile`
- Service: `systemctl enable --now caddy`
- Reload: `systemctl reload caddy`
- Logs: `journalctl -u caddy`
- Canonical DNS target: `185.216.213.200`

## Migration auf bestehendem VPS

Im Repo-Root:

```sh
sudo bash ./scripts/migrate_snap_caddy.sh
```

Oder im normalen Update-Lauf direkt mitziehen:

```sh
sudo ./scripts/deploy_prod.sh
```

Der Deploy-Wrapper ruft automatisch `scripts/ensure_caddy_systemd.sh` auf und migriert Snap-Caddy bei Bedarf direkt mit.

Das Skript macht:
- Backup von `/var/snap/caddy` nach `/root/caddy-snap-backup-<timestamp>`
- Best-effort-Übernahme der bestehenden `Caddyfile`
- Best-effort-Kopie von Zertifikats-/State-Daten
- Installation des offiziellen apt-Caddy
- Aktivierung von `caddy` via `systemd`
- Installation des Self-Healing-Timers
- Stop/Disable/Remove von Snap-Caddy

## Nach der Migration prüfen

```sh
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl status caddy --no-pager
sudo journalctl -u caddy -n 120 --no-pager
sudo ss -ltn | grep -E '(:80|:443)'
curl -I http://127.0.0.1
```

Extern:

```sh
curl -I https://desk.uliquid.vip
curl -I https://api.desk.uliquid.vip/health
```

Typical production domains:

```text
Web: desk.uliquid.vip
API: api.desk.uliquid.vip
Server IP: 185.216.213.200
```

## Self-Healing

Installiert werden:
- `/usr/local/bin/caddy-self-heal.sh`
- `/etc/systemd/system/caddy-self-heal.service`
- `/etc/systemd/system/caddy-self-heal.timer`

Timer prüfen:

```sh
sudo systemctl status caddy-self-heal.timer --no-pager
sudo journalctl -u caddy-self-heal.service -n 50 --no-pager
```

Der Check prüft:
- `systemctl is-active caddy`
- `ss -ltn` für Ports `80` und `443`

Wenn nötig:
- `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`
- `systemctl restart caddy`

## Frische Installation

```sh
sudo bash ./scripts/install_caddy_apt.sh
```

Danach:

```sh
sudo nano /etc/caddy/Caddyfile
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
```
