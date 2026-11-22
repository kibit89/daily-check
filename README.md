# Daily Check

A small offline-first daily check-in app. It runs entirely in the browser and is installable
on the home screen (PWA) from Android Chrome or iOS Safari.

- **Private by design** — no account, no server, no analytics. Everything you record is kept in
  the browser's `localStorage` on your own device.
- **Today** — one tap to mark each time slot, with an optional mood and a short note.
- **Calendar** — a monthly overview: green when every slot was taken on time, amber when
  something was taken late, red when a slot was missed.
- **Backup** — export and restore all data as a JSON file.
- **Settings** — edit time slots, per-slot item names, and reminders while the app is open.

## Run locally

Any static server works:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy

GitHub Pages serves the `main` branch root. No build step and no dependencies.

## Notes

- A "day" starts at 04:00, so something logged at 00:30 still belongs to the previous day.
- The service worker caches the app shell for offline use; new deployments are picked up on the
  next navigation.
- Background push notifications would need a server. While the app is open (or recently opened),
  it can raise a local notification when a time slot starts.
