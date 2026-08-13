export type EmojiEntry = { emoji: string; name: string; keywords: string };
export type EmojiCategory = { name: string; emojis: EmojiEntry[] };

// The ten reactions called out as the "always available" set, shown as their
// own group at the top of the picker regardless of search/category state.
export const QUICK_EMOJIS = ["❤️", "😂", "😍", "😢", "😡", "👍", "👎", "🎉", "🔥", "🚀"];

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    name: "Sorrisos",
    emojis: [
      { emoji: "😀", name: "sorriso", keywords: "feliz sorriso smile" },
      { emoji: "😂", name: "risada", keywords: "rindo lol haha risada" },
      { emoji: "🤣", name: "rolando de rir", keywords: "rindo lol muito engraçado" },
      { emoji: "😊", name: "sorriso tímido", keywords: "feliz contente" },
      { emoji: "😍", name: "apaixonado", keywords: "amei olhos coração" },
      { emoji: "🥰", name: "encantado", keywords: "amor carinho" },
      { emoji: "😘", name: "beijo", keywords: "beijo amor" },
      { emoji: "😜", name: "brincalhão", keywords: "piscada língua" },
      { emoji: "🤔", name: "pensativo", keywords: "pensando dúvida" },
      { emoji: "😅", name: "aliviado", keywords: "suor nervoso" },
      { emoji: "😭", name: "chorando muito", keywords: "triste choro" },
      { emoji: "😢", name: "triste", keywords: "choro lágrima" },
      { emoji: "😡", name: "com raiva", keywords: "raiva bravo irritado" },
      { emoji: "🤯", name: "mente explodindo", keywords: "chocado surpresa" },
      { emoji: "🥳", name: "festa", keywords: "comemorar aniversário" },
      { emoji: "😴", name: "dormindo", keywords: "sono cansado" },
      { emoji: "🤗", name: "abraço", keywords: "abraçar carinho" },
      { emoji: "😇", name: "anjinho", keywords: "inocente santo" },
    ],
  },
  {
    name: "Gestos",
    emojis: [
      { emoji: "👍", name: "joinha", keywords: "curtir concordo positivo like" },
      { emoji: "👎", name: "não curtida", keywords: "discordo negativo dislike" },
      { emoji: "👏", name: "palmas", keywords: "aplausos parabéns" },
      { emoji: "🙌", name: "mãos para cima", keywords: "comemorar viva" },
      { emoji: "🙏", name: "obrigado", keywords: "prece agradecimento por favor" },
      { emoji: "👌", name: "perfeito", keywords: "ok certo" },
      { emoji: "🤝", name: "aperto de mão", keywords: "acordo negócio" },
      { emoji: "✌️", name: "paz", keywords: "vitória paz" },
      { emoji: "🤙", name: "chamada", keywords: "ligar beleza" },
      { emoji: "💪", name: "força", keywords: "músculo forte" },
    ],
  },
  {
    name: "Corações",
    emojis: [
      { emoji: "❤️", name: "coração", keywords: "amor love vermelho" },
      { emoji: "🧡", name: "coração laranja", keywords: "amor laranja" },
      { emoji: "💛", name: "coração amarelo", keywords: "amor amizade" },
      { emoji: "💚", name: "coração verde", keywords: "amor verde" },
      { emoji: "💙", name: "coração azul", keywords: "amor azul" },
      { emoji: "💜", name: "coração roxo", keywords: "amor roxo" },
      { emoji: "🖤", name: "coração preto", keywords: "amor preto" },
      { emoji: "🤍", name: "coração branco", keywords: "amor branco" },
      { emoji: "💕", name: "dois corações", keywords: "amor carinho" },
      { emoji: "💖", name: "coração brilhante", keywords: "amor especial" },
    ],
  },
  {
    name: "Celebração",
    emojis: [
      { emoji: "🎉", name: "confete", keywords: "festa comemorar parabéns" },
      { emoji: "🎊", name: "bolinhas de festa", keywords: "festa comemorar" },
      { emoji: "🔥", name: "fogo", keywords: "incrível demais top" },
      { emoji: "✨", name: "brilho", keywords: "mágico especial" },
      { emoji: "🚀", name: "foguete", keywords: "lançar rápido decolar" },
      { emoji: "🏆", name: "troféu", keywords: "vitória campeão" },
      { emoji: "🥇", name: "medalha de ouro", keywords: "primeiro lugar vencedor" },
      { emoji: "🎯", name: "alvo", keywords: "foco acertou" },
    ],
  },
  {
    name: "Natureza",
    emojis: [
      { emoji: "🐶", name: "cachorro", keywords: "cão pet fofo" },
      { emoji: "🐱", name: "gato", keywords: "felino pet fofo" },
      { emoji: "🦊", name: "raposa", keywords: "animal esperto" },
      { emoji: "🐼", name: "panda", keywords: "animal fofo" },
      { emoji: "🌸", name: "flor de cerejeira", keywords: "flor primavera" },
      { emoji: "🌈", name: "arco-íris", keywords: "cores diversidade" },
      { emoji: "⭐", name: "estrela", keywords: "destaque favorito" },
      { emoji: "🌙", name: "lua", keywords: "noite sonhos" },
    ],
  },
  {
    name: "Comida",
    emojis: [
      { emoji: "🍕", name: "pizza", keywords: "comida fome" },
      { emoji: "🍔", name: "hambúrguer", keywords: "comida fome" },
      { emoji: "🍟", name: "batata frita", keywords: "comida fome" },
      { emoji: "🍿", name: "pipoca", keywords: "cinema filme" },
      { emoji: "☕", name: "café", keywords: "bebida energia" },
      { emoji: "🍺", name: "cerveja", keywords: "bebida brinde" },
      { emoji: "🎂", name: "bolo", keywords: "aniversário festa" },
      { emoji: "🍩", name: "rosquinha", keywords: "doce sobremesa" },
    ],
  },
  {
    name: "Símbolos",
    emojis: [
      { emoji: "💯", name: "cem pontos", keywords: "perfeito completo top" },
      { emoji: "✅", name: "check", keywords: "concluído aprovado ok" },
      { emoji: "❌", name: "x", keywords: "errado cancelar não" },
      { emoji: "⚡", name: "raio", keywords: "rápido energia" },
      { emoji: "💡", name: "ideia", keywords: "lâmpada insight" },
      { emoji: "🎵", name: "nota musical", keywords: "música som" },
      { emoji: "📌", name: "alfinete", keywords: "fixar importante" },
      { emoji: "💀", name: "caveira", keywords: "morrendo de rir engraçado" },
    ],
  },
];

const NAME_LOOKUP: Record<string, string> = Object.fromEntries(
  EMOJI_CATEGORIES.flatMap((c) => c.emojis.map((e) => [e.emoji, e.name])),
);

export function emojiName(emoji: string): string {
  return NAME_LOOKUP[emoji] ?? emoji;
}

export function findEmojiEntry(emoji: string): EmojiEntry {
  return { emoji, name: emojiName(emoji), keywords: "" };
}
