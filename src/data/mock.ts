export type UserStatus = "online" | "idle" | "offline" | "dnd";

export interface User {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  status: UserStatus;
  bio: string;
  banner: string;
  role?: string;
}

export interface Server {
  id: string;
  name: string;
  initial: string;
  color: string;
  unread?: number;
}

export type ChannelType = "text" | "voice" | "forum";
export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  category: string;
  topic?: string;
}

export interface Reaction {
  emoji: string;
  count: number;
  reacted?: boolean;
}

export interface Message {
  id: string;
  authorId: string;
  channelId: string;
  content: string;
  timestamp: string;
  reactions: Reaction[];
  edited?: boolean;
}

export const currentUser: User = {
  id: "u_me",
  name: "Nova Ryder",
  handle: "nova",
  avatar: "https://api.dicebear.com/9.x/glass/svg?seed=nova&backgroundColor=00D8FF,8DFF2F",
  status: "online",
  bio: "Construindo coisas em alta frequência. Fundadora do coletivo Dexy.",
  banner: "https://images.unsplash.com/photo-1614851099175-e5b30eb872bb?w=1200&q=80",
  role: "Fundadora",
};

export const users: User[] = [
  currentUser,
  { id: "u1", name: "Ravi Solano", handle: "ravi", avatar: "https://api.dicebear.com/9.x/glass/svg?seed=ravi", status: "online", bio: "Backend & sistemas distribuídos.", banner: "", role: "Engenharia" },
  { id: "u2", name: "Iris Vale", handle: "iris", avatar: "https://api.dicebear.com/9.x/glass/svg?seed=iris", status: "idle", bio: "Design de produto e motion.", banner: "", role: "Design" },
  { id: "u3", name: "Kaito Mori", handle: "kaito", avatar: "https://api.dicebear.com/9.x/glass/svg?seed=kaito", status: "online", bio: "Front-end e experimentos WebGL.", banner: "", role: "Engenharia" },
  { id: "u4", name: "Luma Reis", handle: "luma", avatar: "https://api.dicebear.com/9.x/glass/svg?seed=luma", status: "dnd", bio: "Comunidade & suporte.", banner: "", role: "Comunidade" },
  { id: "u5", name: "Enzo Prata", handle: "enzo", avatar: "https://api.dicebear.com/9.x/glass/svg?seed=enzo", status: "offline", bio: "DevRel.", banner: "", role: "DevRel" },
  { id: "u6", name: "Sora Klein", handle: "sora", avatar: "https://api.dicebear.com/9.x/glass/svg?seed=sora", status: "offline", bio: "Escritora técnica.", banner: "", role: "Conteúdo" },
  { id: "u7", name: "Mika Aoki", handle: "mika", avatar: "https://api.dicebear.com/9.x/glass/svg?seed=mika", status: "online", bio: "Segurança e infra.", banner: "", role: "Infra" },
];

export const servers: Server[] = [
  { id: "s1", name: "Dexy HQ", initial: "D", color: "from-[#00D8FF] to-[#8DFF2F]", unread: 3 },
  { id: "s2", name: "Ember Labs", initial: "E", color: "from-amber-400 to-orange-600" },
  { id: "s3", name: "Neon Guild", initial: "N", color: "from-fuchsia-500 to-indigo-600", unread: 12 },
  { id: "s4", name: "Pixel Foundry", initial: "P", color: "from-emerald-400 to-teal-600" },
  { id: "s5", name: "Cinder Club", initial: "C", color: "from-rose-500 to-red-700" },
];

export const channels: Channel[] = [
  { id: "c1", name: "boas-vindas", type: "text", category: "Geral", topic: "Diga oi para todo mundo aqui." },
  { id: "c2", name: "anúncios", type: "text", category: "Geral", topic: "Novidades oficiais da Dexy." },
  { id: "c3", name: "conversa-geral", type: "text", category: "Comunidade", topic: "Papo livre, sem regras rígidas." },
  { id: "c4", name: "showcase", type: "forum", category: "Comunidade", topic: "Mostre o que você está construindo." },
  { id: "c5", name: "sala-de-voz", type: "voice", category: "Comunidade" },
  { id: "c6", name: "ajuda", type: "text", category: "Suporte", topic: "Precisando de uma mão? Pergunte aqui." },
  { id: "c7", name: "bugs", type: "text", category: "Suporte" },
  { id: "c8", name: "front-end", type: "text", category: "Desenvolvimento", topic: "React, TS, animações e afins." },
  { id: "c9", name: "back-end", type: "text", category: "Desenvolvimento" },
  { id: "c10", name: "pair-programming", type: "voice", category: "Desenvolvimento" },
];

export const messages: Message[] = [
  { id: "m1", authorId: "u1", channelId: "c1", content: "Bom dia, gente! Café e commits ☕", timestamp: "09:14", reactions: [{ emoji: "☕", count: 4 }, { emoji: "🔥", count: 2 }] },
  { id: "m2", authorId: "u2", channelId: "c1", content: "Subi um novo protótipo do onboarding — feedbacks são bem-vindos.", timestamp: "09:22", reactions: [{ emoji: "👀", count: 3 }] },
  { id: "m3", authorId: "u3", channelId: "c1", content: "Boa! O gradiente ficou mais quente, gostei.", timestamp: "09:24", reactions: [] },
  { id: "m4", authorId: "u4", channelId: "c1", content: "Alguém pode revisar a issue #482? Está pronta para review.", timestamp: "09:31", reactions: [{ emoji: "✅", count: 1 }] },
  { id: "m5", authorId: "u7", channelId: "c1", content: "Peguei aqui, olho em 15 min.", timestamp: "09:33", reactions: [] },
  { id: "m6", authorId: "u1", channelId: "c1", content: "Reunião de arquitetura movida para 15h — bloqueiem a agenda.", timestamp: "10:02", reactions: [{ emoji: "🗓️", count: 5 }], edited: true },
  { id: "m7", authorId: "u2", channelId: "c1", content: "Consigo estar. Trago as decisões da última rodada.", timestamp: "10:04", reactions: [] },
  { id: "m8", authorId: "u3", channelId: "c1", content: "Também. Vou preparar um demo curto do novo player.", timestamp: "10:07", reactions: [{ emoji: "🎬", count: 2 }, { emoji: "🚀", count: 3 }] },
];

export const notifications = [
  { id: "n1", text: "Ravi mencionou você em #front-end", time: "há 2 min" },
  { id: "n2", text: "Novo tópico no Showcase: 'Editor de rotas 3D'", time: "há 18 min" },
  { id: "n3", text: "Iris compartilhou um arquivo em #design", time: "há 1 h" },
];

export const friends = users.filter((u) => u.id !== "u_me").slice(0, 5);

export const roles = [
  { id: "r1", name: "Fundadora", color: "#00D8FF" },
  { id: "r2", name: "Engenharia", color: "#38bdf8" },
  { id: "r3", name: "Design", color: "#f472b6" },
  { id: "r4", name: "Comunidade", color: "#a78bfa" },
  { id: "r5", name: "DevRel", color: "#34d399" },
];