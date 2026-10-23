# Bestie: a real-time chat app

A full-stack messaging app inspired by WhatsApp. Users can sign up, start one-to-one or group chats, and message each other instantly, with live typing indicators and online status.

![Tests](https://github.com/Darcey001/chat-app/actions/workflows/test.yml/badge.svg)

**🔗 Live demo:** [chatter-axvv.onrender.com](https://chatter-axvv.onrender.com) · open it in two browsers and chat with yourself

<p align="center">
  <img src="docs/WhatsApp%20Image%202026-10-23%20at%2018.45.52.jpeg" alt="Chatter on a phone: an end-to-end encrypted chat with a live typing indicator" width="300">
</p>


##  Features

- **Accounts:** sign up and log in with hashed passwords (bcrypt) and JWT sessions
- **Real-time messaging:** messages appear instantly for everyone in the chat (Socket.IO / WebSockets)
- **Direct and group chats:** start a one-to-one chat, or name a group and add several people
- **Typing indicators:** "Amara is typing…" shows live in the chat and in the chat list
- **Online status:** green dot for who is online, updated live
- **Message history:** messages are saved in a database and load when you open a chat
- **Responsive design:** works on desktop and mobile, with automatic dark mode
- **End-to-end encryption:** messages are encrypted in the browser before they are sent, so the server only ever stores scrambled text ([how it works](#-end-to-end-encryption))
- **Security:** only members can read or post in a conversation, checked on every request and socket event

## Tech stack

| Layer     | Technology |
|-----------|------------|
| Frontend  | React 18, Vite, Socket.IO client, CSS |
| Backend   | Node.js, Express, Socket.IO |
| Database  | SQLite (better-sqlite3) |
| Auth      | JWT, bcrypt |
| Encryption | Web Crypto API: ECDH P-256, AES-256-GCM, PBKDF2 |
| Testing   | Node test runner, GitHub Actions CI |

##  How it works

```
React app ──REST (login, history, create chat)──► Express API ──► SQLite
    ▲                                                  │
    └──────────── WebSocket (Socket.IO) ◄──────────────┘
         message:new · typing · presence · conversation:new
```

- **REST** handles things you ask for once: logging in, loading old messages, creating a chat.
- **WebSockets** handle things that happen live: new messages, typing, and people coming online.
- Each conversation is a Socket.IO *room*, so a message is only sent to that chat's members.
- The server counts open connections per user, so someone with two tabs open stays "online" until both close.

## 🔒 End-to-end encryption

The server never sees what people write. All encryption happens in the browser using the built-in **Web Crypto API**:

1. **Your keys.** When you sign up, your browser creates a key pair (ECDH P-256). The **public key** is shared through the server; the **private key** stays on your device.
2. **Logging in on another device.** A copy of your private key is stored on the server, but it is locked with a key made from your password (PBKDF2, 600,000 rounds). Only your browser can unlock it.
3. **A key for every chat.** Starting a chat creates a random AES-256 key. Your browser encrypts a separate copy of it for each member, using ECDH between your private key and their public key. Only members can unlock their copy.
4. **Messages.** Each message is encrypted with the chat key (AES-256-GCM) before it is sent, and decrypted only on the members' devices. Tampered messages are rejected automatically.

What the server stores: usernames, public keys, password hashes, locked key backups, and encrypted message data. It can't read message text.

**Honest limitations** (what I'd improve next):
- Your password is sent to the server when you log in, so a dishonest server *could* use it to unlock your key backup. Real apps like WhatsApp avoid this with a separate recovery code or by keeping keys only on devices.
- The server can still see *who* talks to *whom* and *when* (metadata), just not *what* they say.
- There's no way yet to verify someone's key (like WhatsApp's "security code"), and no forward secrecy.

## Run it locally

You need [Node.js](https://nodejs.org) 18 or newer.

**1. Start the server**

```bash
cd server
npm install
cp .env.example .env      # then set JWT_SECRET to any long random string
npm run dev               # http://localhost:4000
```

**2. Start the app** (in a second terminal)

```bash
cd client
npm install
npm run dev               # http://localhost:5173
```

Open http://localhost:5173 in two different browsers (or one normal and one private window), create two accounts, and chat between them.

### Run it like production (one server)

```bash
npm run build                     # installs everything and builds the React app
JWT_SECRET=any-secret npm start   # app + API together on http://localhost:4000
```

## Deployment

The app is deployed as **one web service on [Render](https://render.com)**. In production, the Node server also serves the built React app, so the frontend, the REST API and the WebSocket connection all share one address, with no cross-origin setup.

The `render.yaml` file describes the whole setup (build command, start command, health check, and a randomly generated `JWT_SECRET`), so deploying takes a few clicks: **New → Blueprint → select this repo → Apply**.

> Note: on Render's free plan the service sleeps after 15 minutes without visitors (the first visit then takes about a minute), and the SQLite database resets when it restarts. That's fine for a demo. For permanent data, the next step is moving to PostgreSQL.

##  Tests

```bash
cd server
npm test
```

There are two test suites: `client/test` checks the encryption itself (wrong passwords, outsiders and tampered messages are all rejected), and `server/test` runs a full encrypted chat between simulated users and checks that the database never contains readable text.

The server tests start a real server and connect real socket clients. They check sign-up and login rules, real-time delivery between two users, typing indicators, message history, group chats, and that people outside a chat can't read or post in it. They run automatically on every push with GitHub Actions.

## Project structure

```
server/
  src/app.js        REST routes + Socket.IO events
  src/store.js      all database queries
  src/db.js         database tables
  src/auth.js       JWT helpers
  test/             automated tests
client/
  src/components/   AuthForm, ChatLayout, Sidebar, ChatWindow, NewChatModal
  src/crypto.js     end-to-end encryption (Web Crypto API)
  src/keystore.js   keeps your unlocked key in the browser (IndexedDB)
  src/api.js        API helper
```

##  What's next

- [ ] Read receipts (✓✓)
- [ ] Image and file sharing
- [ ] Message search
- [x] Deploy live on Render
- [ ] Move from SQLite to PostgreSQL so data persists between deploys

## 👩🏾‍💻 Author

**Praise Emmanuel** · [GitHub](https://github.com/Darcey001) · [LinkedIn](https://www.linkedin.com/in/praise-emmanuel-894047223/)
