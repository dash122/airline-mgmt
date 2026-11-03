// Ground and sea alternatives between cities (approximate door-to-door hours and one-way fares in NT$).
export interface SurfaceLink {
  a: string; // city key
  b: string;
  name: string;
  hours: number;
  fare: number;
}

export const SURFACE: SurfaceLink[] = [
  { a: 'taipei', b: 'taichung', name: '台灣高鐵', hours: 1.6, fare: 700 },
  { a: 'taipei', b: 'tainan', name: '台灣高鐵', hours: 2.4, fare: 1350 },
  { a: 'taipei', b: 'kaohsiung', name: '台灣高鐵', hours: 2.6, fare: 1490 },
  { a: 'taichung', b: 'kaohsiung', name: '台灣高鐵', hours: 1.6, fare: 790 },
  { a: 'taichung', b: 'tainan', name: '台灣高鐵', hours: 1.3, fare: 650 },
  { a: 'taipei', b: 'hualien', name: '台鐵', hours: 3.0, fare: 440 },
  { a: 'taipei', b: 'taitung', name: '台鐵', hours: 5.0, fare: 790 },
  { a: 'kaohsiung', b: 'taitung', name: '台鐵', hours: 3.0, fare: 360 },
  { a: 'hualien', b: 'taitung', name: '台鐵', hours: 2.3, fare: 340 },
  { a: 'hongkong', b: 'macau', name: '港珠澳大橋 / 渡輪', hours: 1.5, fare: 450 },
  { a: 'tokyo', b: 'osaka', name: '新幹線', hours: 3.3, fare: 3100 },
  { a: 'tokyo', b: 'nagoya', name: '新幹線', hours: 2.2, fare: 2400 },
  { a: 'tokyo', b: 'sendai', name: '新幹線', hours: 2.2, fare: 2400 },
  { a: 'tokyo', b: 'hiroshima', name: '新幹線', hours: 4.8, fare: 4200 },
  { a: 'tokyo', b: 'fukuoka', name: '新幹線', hours: 5.8, fare: 5000 },
  { a: 'osaka', b: 'nagoya', name: '新幹線', hours: 1.3, fare: 1500 },
  { a: 'osaka', b: 'hiroshima', name: '新幹線', hours: 2.0, fare: 2300 },
  { a: 'osaka', b: 'fukuoka', name: '新幹線', hours: 3.2, fare: 3300 },
  { a: 'osaka', b: 'kagoshima', name: '新幹線', hours: 4.5, fare: 4400 },
  { a: 'osaka', b: 'kumamoto', name: '新幹線', hours: 3.8, fare: 4000 },
  { a: 'fukuoka', b: 'kumamoto', name: '新幹線', hours: 1.0, fare: 1100 },
  { a: 'fukuoka', b: 'kagoshima', name: '新幹線', hours: 1.8, fare: 2300 },
  { a: 'fukuoka', b: 'nagasaki', name: '新幹線', hours: 1.8, fare: 1300 },
  { a: 'fukuoka', b: 'hiroshima', name: '新幹線', hours: 1.6, fare: 2000 },
];

export function surfaceBetween(cityA: string, cityB: string): SurfaceLink | undefined {
  return SURFACE.find((s) => (s.a === cityA && s.b === cityB) || (s.a === cityB && s.b === cityA));
}
