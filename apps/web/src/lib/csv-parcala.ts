/**
 * CSV'yi baslik satiri her parcada tekrarlanacak sekilde ~butce baytlik parcalara boler. Tirnak icinde satir sonu
 * olabileceginden satirlar tirnak dengesine gore birlestirilir (alan icindeki "\n" parcayi bolmez).
 */
export function csvParcala(metin: string, butce: number): string[] {
  const temiz = metin.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const satirlar: string[] = [];
  let tampon = '';
  for (const s of temiz.split('\n')) {
    tampon = tampon ? `${tampon}\n${s}` : s;
    if ((tampon.match(/"/g)?.length ?? 0) % 2 === 0) { if (tampon.trim()) satirlar.push(tampon); tampon = ''; }
  }
  if (tampon.trim()) satirlar.push(tampon);
  const [baslik, ...govde] = satirlar;
  if (!baslik) return [];
  const out: string[] = [];
  let cur: string[] = [];
  let boy = baslik.length;
  for (const s of govde) {
    if (cur.length && boy + s.length + 1 > butce) { out.push([baslik, ...cur].join('\n')); cur = []; boy = baslik.length; }
    cur.push(s);
    boy += s.length + 1;
  }
  if (cur.length) out.push([baslik, ...cur].join('\n'));
  return out;
}
