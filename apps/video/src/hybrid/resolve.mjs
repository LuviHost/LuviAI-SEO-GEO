/**
 * Hibrit tanitim videosu (src/hybrid/script.json) → schedule.mjs'in okudugu sutun-betigi bicimi.
 *
 * Panel ve kapanis sahneleri dogrulanmis sutun metinlerini KOPYALAR (src/pillars/script.json): sahne
 * { ref: 'geo/measure', pick: { ogeId: vurus } } kaynak sahnenin tur/icerik/menu alanlarini ve SECILEN
 * ogelerin metnini aynen alir; yalniz giris vurusu (at) degisir. Pick yoksa sahne oldugu gibi gelir.
 * Oge duzeyinde { ref: 'geo/hook/q' } metni kaynaktan alir. Boylece hibrit video yeni iddia uyduramaz:
 * metin degisirse sutun videolariyla birlikte degisir. Kaynakta olmayan oge / sahne → hata.
 *
 * Saf JavaScript (Remotion paketi + Node: synth-pillars.mjs, check-pillars-readability.mjs, render-marketing.mjs).
 */

function sourceScene(pillars, ref) {
  const [vid, sid] = ref.split('/');
  const v = pillars.videos.find((x) => x.id === vid);
  const s = v?.scenes.find((x) => x.id === sid);
  if (!s) throw new Error(`hybrid: kaynak sahne yok: ${ref}`);
  return s;
}

function sourceItem(pillars, ref) {
  const [vid, sid, iid] = ref.split('/');
  const it = sourceScene(pillars, `${vid}/${sid}`).items.find((x) => x.id === iid);
  if (!it) throw new Error(`hybrid: kaynak oge yok: ${ref}`);
  return it;
}

function resolveScene(pillars, sc) {
  if (sc.ref) {
    const src = sourceScene(pillars, sc.ref);
    const { ref: _r, pick, ...own } = sc;
    const items = pick
      ? Object.entries(pick).map(([id, at]) => {
          const it = src.items.find((x) => x.id === id);
          if (!it) throw new Error(`hybrid: ${sc.ref} sahnesinde '${id}' yok`);
          return { ...it, at };
        })
      : src.items;
    return { ...src, ...own, items };
  }
  return {
    ...sc,
    items: sc.items.map((it) => {
      if (!it.ref) return it;
      const { ref, ...rest } = it;
      const src = sourceItem(pillars, ref);
      return { ...src, ...rest, text: src.text };
    }),
  };
}

/** { videos: [...] } — planVideo(sonuc, 'hibrit') ile planlanir */
export function resolveHybrid(pillars, hybrid) {
  return {
    _: hybrid._,
    site: pillars.site,
    videos: hybrid.videos.map((v) => ({ ...v, scenes: v.scenes.map((sc) => resolveScene(pillars, sc)) })),
  };
}
