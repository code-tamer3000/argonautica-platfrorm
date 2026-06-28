# Frontend — React + Vite (PWA)

Структура папок задана; сам проект Vite инициализировать в этой директории:

    npm create vite@latest . -- --template react-ts
    npm install
    npm install -D vite-plugin-pwa     # PWA: manifest + service worker

Раскладка `src/`:
- `api/`        — клиент REST + WebSocket
- `components/` — переиспользуемые UI-компоненты (по дизайн-системе)
- `features/`   — фичи (чат, треды, база знаний, календарь, кабинет)
- `hooks/`      — кастомные хуки (в т.ч. реконнект WebSocket)
- `lib/`        — утилиты

ВАЖНО: клиент обязан переподключать WebSocket — при blue-green деплое сокеты рвутся.
