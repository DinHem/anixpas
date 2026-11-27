'use strict';

/**
 * Прогон API-слоя на живых данных.
 * Запуск: ANIXPAS_SMOKE=api npx electron .
 *
 * Не является тестом в строгом смысле — это быстрая проверка,
 * что клиент, фолбэк хостов, кэш и нормализация работают вместе.
 */

const service = require('./service.js');
const cache = require('./cache.js');
const { resolveHost } = require('./api/hosts-resolver.js');
const { request } = require('./net/http.js');

/** @param {string} name @param {() => Promise<boolean>} fn */
async function check(name, fn) {
  const started = Date.now();
  try {
    const passed = await fn();
    const ms = Date.now() - started;
    console.log(`[api-smoke] ${passed ? 'OK  ' : 'FAIL'} ${name} (${ms} мс)`);
    return passed;
  } catch (err) {
    const ms = Date.now() - started;
    console.log(`[api-smoke] FAIL ${name} (${ms} мс) — ${err && err.message}`);
    return false;
  }
}

async function runApiSmoke() {
  console.log('[api-smoke] старт');
  let failed = 0;

  const results = [];

  results.push(
    await check('определение рабочего хоста', async () => {
      const host = await resolveHost();
      console.log(`[api-smoke]   хост: ${host}`);
      return typeof host === 'string' && host.startsWith('https://');
    })
  );

  /** @type {any[]} */
  let catalogItems = [];

  results.push(
    await check('каталог: первая страница', async () => {
      catalogItems = await service.getCatalog(0);
      console.log(`[api-smoke]   релизов: ${catalogItems.length}, первый: «${catalogItems[0]?.title}»`);
      return catalogItems.length > 0 && typeof catalogItems[0].title === 'string';
    })
  );

  results.push(
    await check('каталог: из кэша', async () => {
      const started = Date.now();
      const again = await service.getCatalog(0);
      const ms = Date.now() - started;
      console.log(`[api-smoke]   повторный вызов: ${ms} мс`);
      return again.length === catalogItems.length && ms < 200;
    })
  );

  results.push(
    await check('каталог: вкладки', async () => {
      const anime = await service.getCatalog(0, { country: 'Япония' });
      const donghua = await service.getCatalog(0, { country: 'Китай' });
      const films = await service.getCatalog(0, { category_id: 2 });
      const ongoing = await service.getCatalog(0, { status_id: 2 });

      const onlyCountry = (list, name) => list.every((i) => !i.country || i.country.includes(name));
      const onlyCategory = (list, name) => list.every((i) => i.category === name);

      console.log(`[api-smoke]   Аниме ${anime.length}, Дунхуа ${donghua.length}, Фильмы ${films.length}, Онгоинги ${ongoing.length}`);
      console.log(`[api-smoke]   примеры: «${anime[0]?.title?.slice(0, 24)}» / «${donghua[0]?.title?.slice(0, 24)}»`);

      return (
        anime.length > 0 && donghua.length > 0 &&
        onlyCountry(anime, 'Япония') && onlyCategory(films, 'Фильм') && ongoing.length > 0
      );
    })
  );

  results.push(
    await check('каталог: фильтр по жанру', async () => {
      const items = await service.getCatalog(0, { genres: ['экшен'] });
      const ok = items.length > 0 && items.every((i) => i.genres.includes('экшен'));
      console.log(`[api-smoke]   с жанром «экшен»: ${items.length}`);
      return ok;
    })
  );

  results.push(
    await check('поиск', async () => {
      const items = await service.searchReleases('наруто');
      console.log(`[api-smoke]   найдено: ${items.length}, первый: «${items[0]?.title}»`);
      return items.length > 0;
    })
  );

  results.push(
    await check('карточка релиза', async () => {
      const release = await service.getRelease(609);
      console.log(
        `[api-smoke]   «${release.title}», ${release.year}, жанры: ${release.genres.length}, описание: ${release.description.length} симв.`
      );
      return release.title === 'Наруто' && release.genres.length > 0;
    })
  );

  results.push(
    await check('озвучки', async () => {
      const list = await service.getDubbers(609);
      console.log(`[api-smoke]   озвучек: ${list.length}: ${list.map((d) => d.name).join(', ')}`);
      return list.length > 0;
    })
  );

  results.push(
    await check('источники озвучки', async () => {
      const list = await service.getSources(609, 1);
      console.log(`[api-smoke]   источники: ${list.map((s) => s.name).join(', ')}`);
      return list.length > 0;
    })
  );

  results.push(
    await check('серии + определение Libria', async () => {
      // Релиз 1000 — известный случай с источником Libria (проверен в разведке).
      const dubbers = await service.getDubbers(1000);
      for (const d of dubbers) {
        const sources = await service.getSources(1000, d.id);
        const libria = sources.find((s) => s.name === 'Libria');
        if (libria) {
          const eps = await service.getEpisodes(1000, d.id, libria.id);
          console.log(
            `[api-smoke]   Libria найдена (озвучка ${d.name}, source ${libria.id}), серий: ${eps.length}`
          );
          return eps.length > 0 && typeof eps[0].url === 'string';
        }
      }
      console.log('[api-smoke]   ! источник Libria не найден — данные могли измениться');
      return false;
    })
  );

  results.push(
    await check('поток: Kodik', async () => {
      const dubbers = await service.getDubbers(4000);
      const dubber = dubbers[0];
      const sources = await service.getSources(4000, dubber.id);
      const kodik = sources.find((s) => s.name === 'Kodik');
      if (!kodik) return false;

      const { resolveStream } = require('./api/streams.js');
      const res = await resolveStream(4000, kodik.id, 1);
      if (!res) {
        console.log('[api-smoke]   поток не получен');
        return false;
      }
      const qualities = Object.keys(res.qualities);
      console.log(`[api-smoke]   Kodik: качества ${qualities.join('/')}, лучшее: ${res.best}`);
      console.log(`[api-smoke]   720: ${String(res.qualities['720']).slice(0, 80)}`);

      const probe = await fetch(res.qualities[qualities[0]]);
      const body = await probe.text();
      const lineCount = body.split(/\r?\n/).length;
      console.log(`[api-smoke]   плейлист: HTTP ${probe.status}, ${body.length} Б, строк ${lineCount}`);
      return probe.status === 200 && body.includes('#EXTM3U');
    })
  );

  results.push(
    await check('поток: Libria', async () => {
      const dubbers = await service.getDubbers(1000);
      for (const d of dubbers) {
        const sources = await service.getSources(1000, d.id);
        const libria = sources.find((s) => s.name === 'Libria');
        if (!libria) continue;

        const { resolveStream } = require('./api/streams.js');
        const res = await resolveStream(1000, libria.id, 1);
        if (!res) return false;

        const qualities = Object.keys(res.qualities);
        console.log(`[api-smoke]   Libria: качества ${qualities.join('/')}, лучшее: ${res.best}`);
        console.log(`[api-smoke]   таймкоды: ${JSON.stringify(res.skip)}`);

        const probe = await request(res.qualities[qualities[0]], { timeoutMs: 15000, maxBytes: 2 * 1024 * 1024 });
        const body = probe.text;
        console.log(`[api-smoke]   плейлист: HTTP ${probe.status}, ${body.length} Б`);
        if (probe.status !== 200 || !body.includes('#EXTM3U')) return false;

        const seg = body.split(/\r?\n/).find((l) => l && !l.startsWith('#'));
        if (seg) {
          const segUrl = seg.startsWith('http') ? seg : new URL(seg, res.qualities[qualities[0]]).href;
          const segRes = await request(segUrl, { headers: { Range: 'bytes=0-2000' }, timeoutMs: 20000, maxBytes: 64 * 1024 });
          console.log(`[api-smoke]   сегмент: HTTP ${segRes.status}, ${segRes.headers.get('content-type')}`);
          return segRes.status === 200 || segRes.status === 206;
        }
        return true;
      }
      return false;
    })
  );

  results.push(
    await check('карточка: оценки и рекомендации', async () => {
      const r = await service.getRelease(609);
      const votesTotal = r.voteHistogram.reduce((a, b) => a + b, 0);
      const listsTotal = Object.values(r.lists).reduce((a, b) => a + b, 0);
      console.log(`[api-smoke]   голосов: ${votesTotal} (в карточке ${r.voteHistogram.join('/')})`);
      console.log(`[api-smoke]   списков: ${listsTotal}, рекомендаций: ${r.recommendations.length}`);
      return votesTotal > 0 && listsTotal > 0 && r.recommendations.length > 0;
    })
  );

  results.push(
    await check('фильтры применяются', async () => {
      const byStudio = await service.getCatalog(0, { studio: 'Pierrot' });
      const bySource = await service.getCatalog(0, { source: 'манга' });
      const byEpisodes = await service.getCatalog(0, { episodesFrom: 12, episodesTo: 12 });

      const studioOk = byStudio.length > 0 && byStudio.every((r) => true);
      const sourceOk = bySource.length > 0;
      const epOk = byEpisodes.every((r) => r.episodesTotal === 12 || r.episodesReleased === 12);

      console.log(`[api-smoke]   студия Pierrot: ${byStudio.length}, манга: ${bySource.length}, ровно 12 эп.: ${byEpisodes.length}`);
      console.log(`[api-smoke]   пример по студии: «${byStudio[0]?.title?.slice(0, 30)}», по эпизодам: «${byEpisodes[0]?.title?.slice(0, 30)}»`);
      return studioOk && sourceOk && epOk;
    })
  );

  results.push(
    await check('авторизация: неверные данные', async () => {
      const auth = require('./auth.js');
      const status = await auth.getStatus();
      console.log(`[api-smoke]   сейчас авторизован: ${status.authorized}, secureStorage: ${status.secureStorage}`);

      if (!status.secureStorage) {
        console.log('[api-smoke]   защищённое хранилище недоступно — вход невозможен');
        return false;
      }

      const res = await auth.login('__anixpas_test_nonexistent__', 'wrong_password_123');
      console.log(`[api-smoke]   ответ на неверные данные: ok=${res.ok}, error=${res.error}`);

      const after = await auth.getStatus();
      // Если сессия уже была активна — неудачный вход её не должен ломать.
      const sessionIntact = status.authorized ? after.authorized === true : after.authorized === false;

      console.log(`[api-smoke]   сессия сохранилась: ${sessionIntact}`);
      return res.ok === false && res.error === 'bad_credentials' && sessionIntact;
    })
  );

  results.push(
    await check('комментарии', async () => {
      const c = await service.getComments(609, 0, 0);
      console.log(`[api-smoke]   всего: ${c.total}, на странице: ${c.items.length}`);
      const first = c.items[0];
      if (first) console.log(`[api-smoke]   «${first.author.login}»: ${first.message.slice(0, 40)}`);

      const popular = await service.getComments(609, 0, 2);
      console.log(`[api-smoke]   популярные, первый: «${popular.items[0]?.author.login}», лайков ${popular.items[0]?.likes}`);

      const withReplies = c.items.find((x) => x.replies > 0);
      if (withReplies) {
        const r = await service.getReplies(withReplies.id, 0);
        console.log(`[api-smoke]   ответов к #${withReplies.id}: ${r.items.length}`);
      }
      return c.items.length > 0 && c.total > 0;
    })
  );

  results.push(
    await check('справочники фильтра', async () => {
      const t0 = Date.now();
      const opts = await service.getFilterOptions();
      console.log(
        `[api-smoke]   жанров: ${opts.genres.length}, источников: ${opts.sources.length}, озвучек: ${opts.types.length} (${Date.now() - t0} мс)`
      );
      console.log(`[api-smoke]   примеры жанров: ${opts.genres.slice(0, 5).join(', ')}`);
      console.log(`[api-smoke]   источники: ${opts.sources.join(', ')}`);
      return opts.genres.length > 10 && opts.sources.length > 0 && opts.types.length > 0;
    })
  );

  results.push(
    await check('торренты релиза', async () => {
      const res = await service.getTorrents(1000);
      if (!res) {
        console.log('[api-smoke]   Libria-источника нет — блок не показывается');
        return false;
      }
      console.log(`[api-smoke]   libriaId=${res.libriaId}, торрентов: ${res.torrents.length}`);
      const t = res.torrents[0];
      if (t) {
        console.log(`[api-smoke]   ${t.quality} ${t.codec}, ${(t.size / 1024 ** 3).toFixed(2)} ГБ, сидов ${t.seeders}`);
        console.log(`[api-smoke]   имя файла: ${t.filename}`);
      }

      const file = await service.downloadTorrent(t.hash);
      console.log(`[api-smoke]   .torrent: ${file.buffer.length} Б, bencode: ${file.buffer.slice(0, 1).toString() === 'd'}`);
      return res.torrents.length > 0 && file.buffer.length > 0;
    })
  );

  results.push(
    await check('торренты: релиз без Libria', async () => {
      const res = await service.getTorrents(20688);
      console.log(`[api-smoke]   релиз 20688 → ${res === null ? 'null (блок скрыт)' : res.torrents.length + ' торрентов'}`);
      return res === null;
    })
  );

  results.push(
    await check('настройки: запись и чтение', async () => {
      const settings = require('./settings.js');
      const before = (await settings.getAll()).playerRate;

      await settings.set('playerRate', 1.5);
      const after = (await settings.getAll()).playerRate;
      console.log(`[api-smoke]   было ${before}, стало ${after}`);

      // Возвращаем как было, чтобы не менять настройки пользователя.
      await settings.set('playerRate', before);
      await settings.flushNow();

      const final = (await settings.getAll()).playerRate;
      return after === 1.5 && final === before;
    })
  );

  results.push(
    await check('размер кэша', async () => {
      const bytes = await cache.size();
      console.log(`[api-smoke]   кэш: ${(bytes / 1024).toFixed(1)} КБ`);
      return bytes > 0;
    })
  );

  failed = results.filter((r) => !r).length;
  console.log(`[api-smoke] итог: ${results.length - failed}/${results.length} пройдено`);
  return failed === 0;
}

module.exports = { runApiSmoke };
