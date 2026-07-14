// ===== CONFIG & CONSTANTS =====
export const AK = '2b834d5234781ad70bd646922e9ddd18';
export const BASE = 'https://api.themoviedb.org/3';
export const IMG = 'https://image.tmdb.org/t/p/';
// Single-quoted SVG attrs (not double) so this string is safe to embed
// directly inside a double-quoted HTML attribute (data-ph="${PH}") without
// the HTML parser terminating the attribute early on an internal ".
export const PH = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='450'><rect fill='%2314141f' width='300' height='450'/><text x='150' y='230' text-anchor='middle' fill='%234b5563' font-size='14' font-family='sans-serif'>No Image</text></svg>";

// Pick the best title-logo file_path from a TMDB images.logos array: prefer an
// English logo, then a language-neutral one (iso_639_1 === null), then the first.
// Returns null when there are no logos (caller falls back to the title text).
export function pickLogo(logos) {
  if (!Array.isArray(logos) || !logos.length) return null;
  const en = logos.find(l => l && l.iso_639_1 === 'en' && l.file_path);
  const neutral = logos.find(l => l && l.iso_639_1 === null && l.file_path);
  const any = logos.find(l => l && l.file_path);
  return (en || neutral || any || {}).file_path || null;
}

export const firebaseConfig = {
  apiKey: "AIzaSyDtcGPY2iCh4SsjFIid_H0lwMfIj9ocN8I",
  authDomain: "movies-2b6dd.firebaseapp.com",
  projectId: "movies-2b6dd",
  storageBucket: "movies-2b6dd.firebasestorage.app",
  messagingSenderId: "229804615049",
  appId: "1:229804615049:web:5d438b81c71137d0c3ad58"
};

export const genreMap = {28:'Action',12:'Adventure',16:'Animation',35:'Comedy',80:'Crime',99:'Documentary',18:'Drama',10751:'Family',14:'Fantasy',36:'History',27:'Horror',10402:'Music',9648:'Mystery',10749:'Romance',878:'Sci-Fi',10770:'TV Movie',53:'Thriller',10752:'War',37:'Western',10759:'Action & Adventure',10762:'Kids',10763:'News',10764:'Reality',10765:'Sci-Fi & Fantasy',10766:'Soap',10767:'Talk',10768:'War & Politics'};

export const mGenreList=[{id:28,n:'Action'},{id:12,n:'Adventure'},{id:16,n:'Animation'},{id:35,n:'Comedy'},{id:80,n:'Crime'},{id:99,n:'Documentary'},{id:18,n:'Drama'},{id:10751,n:'Family'},{id:14,n:'Fantasy'},{id:36,n:'History'},{id:27,n:'Horror'},{id:10402,n:'Music'},{id:9648,n:'Mystery'},{id:10749,n:'Romance'},{id:878,n:'Sci-Fi'},{id:53,n:'Thriller'},{id:10752,n:'War'},{id:37,n:'Western'}];
export const tGenreList=[{id:10759,n:'Action'},{id:16,n:'Animation'},{id:35,n:'Comedy'},{id:80,n:'Crime'},{id:99,n:'Documentary'},{id:18,n:'Drama'},{id:10751,n:'Family'},{id:10762,n:'Kids'},{id:9648,n:'Mystery'},{id:10765,n:'Sci-Fi'},{id:10768,n:'War & Politics'},{id:37,n:'Western'}];

export const moods=[
  {emoji:'😂',name:'Fun & Lighthearted',sub:'Comedies & feel-good',genres:'35,10751',type:'movie'},
  {emoji:'💀',name:'Dark & Thrilling',sub:'Horror & suspense',genres:'27,53',type:'movie'},
  {emoji:'❤️',name:'Romantic',sub:'Love stories',genres:'10749',type:'movie'},
  {emoji:'🚀',name:'Epic Adventure',sub:'Action & sci-fi',genres:'28,878,12',type:'movie'},
  {emoji:'🧠',name:'Mind-Bending',sub:'Thought-provoking',genres:'9648,878',type:'movie'},
  {emoji:'📖',name:'True Stories',sub:'Documentaries & biopics',genres:'99,36',type:'movie'},
  {emoji:'👨‍👩‍👧‍👦',name:'Family Night',sub:'For everyone',genres:'16,10751',type:'movie'},
  {emoji:'😢',name:'Emotional',sub:'Drama & tearjerkers',genres:'18',type:'movie'},
  {emoji:'🎭',name:'Classic Cinema',sub:'Timeless masterpieces',genres:'18,36',type:'movie'},
  {emoji:'🌍',name:'World Cinema',sub:'International films',genres:'18',type:'movie',lang:'ko'},
  {emoji:'📺',name:'Binge-worthy Shows',sub:'Addictive TV series',genres:'18',type:'tv'},
  {emoji:'🔮',name:'Fantasy Worlds',sub:'Magic & wonder',genres:'14,10765',type:'multi'},
];

export const REGIONS=[['IN','🇮🇳 India'],['US','🇺🇸 US'],['GB','🇬🇧 UK'],['SA','🇸🇦 Saudi Arabia'],['AU','🇦🇺 Australia']];
