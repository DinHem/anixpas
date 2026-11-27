<script>
  /**
   * Комментарии к релизу.
   *
   * Чтение публичное. Лайки и ответы требуют авторизации,
   * поэтому кнопки показаны, но неактивны с подсказкой.
   */
  import { onMount } from 'svelte';
  import { bridge } from '../lib/bridge.js';
  import { timeAgo, formatCount, plural } from '../lib/format.js';

  /** @type {{ releaseId: number, initialCount?: number }} */
  let { releaseId, initialCount = 0 } = $props();

  /** @type {any[]} */
  let items = $state([]);
  let page = $state(0);
  let total = $state(0);
  /** @type {0|2} */
  let sort = $state(0);
  let loading = $state(false);
  let error = $state('');
  /** Данные кончились — кнопка «Показать ещё» больше не нужна. */
  let exhausted = $state(false);
  let expanded = $state(false);

  /** Раскрытые ответы: id комментария → массив. */
  /** @type {Record<number, any[]>} */
  let replies = $state({});
  /** Раскрытые спойлеры. */
  /** @type {Set<number>} */
  let revealed = $state(new Set());

  async function load() {
    if (loading) return;
    loading = true;
    error = '';

    try {
      // API может вернуть пустую или полностью дублирующую страницу —
      // тогда сразу берём следующую, но не больше трёх попыток подряд.
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await bridge.comments(releaseId, page, sort);
        page += 1;

        // Страницы могут пересекаться — дедупликация обязательна.
        const known = new Set(items.map((c) => c.id));
        const fresh = res.items.filter((c) => !known.has(c.id));

        if (fresh.length > 0) {
          items = [...items, ...fresh];
          total = res.total;
          break;
        }

        // Пришло пусто или одни дубликаты — дальше данных нет.
        exhausted = true;
      }
    } catch (err) {
      error = err && err.message ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  async function switchSort(next) {
    if (next === sort) return;
    sort = next;
    items = [];
    page = 0;
    replies = {};
    exhausted = false;
    await load();
  }

  /** Открыть общий список. */
  async function open() {
    expanded = true;
    if (items.length === 0) await load();
  }

  /** @param {number} id */
  async function toggleReplies(id) {
    if (replies[id]) {
      const copy = { ...replies };
      delete copy[id];
      replies = copy;
      return;
    }

    try {
      const res = await bridge.replies(id, 0);
      replies = { ...replies, [id]: res.items };
    } catch {
      /* ответы недоступны — молча игнорируем */
    }
  }

  /** @param {number} id */
  function reveal(id) {
    const next = new Set(revealed);
    next.add(id);
    revealed = next;
  }

  onMount(() => {
    // Превью грузим сразу — 3 комментария, чтобы блок не выглядел пустым.
    if (initialCount > 0) {
      bridge
        .comments(releaseId, 0, 0)
        .then((res) => {
          items = res.items.slice(0, 3);
          total = res.total;
          page = 1;
        })
        .catch(() => {});
    }
  });
</script>

<div class="section-block">
  <div class="comments-head">
    <h3>
      Комментарии
      {#if total}<span class="meta dim">{formatCount(total)}</span>{/if}
    </h3>

    {#if expanded}
      <div class="segmented">
        <button class:active={sort === 2} onclick={() => switchSort(2)}>Популярные</button>
        <button class:active={sort === 0} onclick={() => switchSort(0)}>Новые</button>
      </div>
    {:else if total > items.length}
      <button class="linkbtn" onclick={open}>Показать все ({total})</button>
    {/if}
  </div>

  {#if error}
    <p class="err">{error}</p>
  {/if}

  {#if items.length === 0 && !loading}
    <p class="meta dim">Комментариев пока нет</p>
  {/if}

  <ul class="comments">
    {#each items as comment (comment.id)}
      <li class="comment">
        <div class="comment-avatar">
          {#if comment.author.avatar}
            <img src={comment.author.avatar} alt="" loading="lazy" referrerpolicy="no-referrer" />
          {/if}
        </div>

        <div class="comment-body">
          <div class="comment-head">
            <span class="comment-author">{comment.author.login}</span>
            {#if comment.author.badge}
              <span class="tag">{comment.author.badge}</span>
            {/if}
            <span class="meta dim">{timeAgo(comment.timestamp)}</span>
            {#if comment.episode}
              <span class="meta dim">· на моменте выхода {comment.episode} серии</span>
            {/if}
          </div>

          {#if comment.isSpoiler && !revealed.has(comment.id)}
            <button class="spoiler" onclick={() => reveal(comment.id)}>
              Спойлер — нажмите, чтобы показать
            </button>
          {:else}
            <p class="comment-text">{comment.message}</p>
          {/if}

          <div class="comment-actions">
            {#if comment.likes > 0}
              <span class="meta dim">♥ {comment.likes}</span>
            {/if}

            {#if comment.replies > 0}
              <button class="linkbtn small" onclick={() => toggleReplies(comment.id)}>
                {replies[comment.id]
                  ? 'Скрыть ответы'
                  : `Ответы (${comment.replies})`}
              </button>
            {/if}

            {#if comment.isEdited}
              <span class="meta dim">изменён</span>
            {/if}
          </div>

          {#if replies[comment.id]}
            <ul class="replies">
              {#each replies[comment.id] as reply (reply.id)}
                <li class="comment reply">
                  <div class="comment-avatar small">
                    {#if reply.author.avatar}
                      <img src={reply.author.avatar} alt="" loading="lazy" referrerpolicy="no-referrer" />
                    {/if}
                  </div>
                  <div class="comment-body">
                    <div class="comment-head">
                      <span class="comment-author">{reply.author.login}</span>
                      <span class="meta dim">{timeAgo(reply.timestamp)}</span>
                    </div>
                    <p class="comment-text">{reply.message}</p>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </li>
    {/each}
  </ul>

  {#if expanded}
    <div class="foot">
      {#if exhausted}
        <span class="meta dim">Больше нет</span>
      {:else}
        <button onclick={load} disabled={loading}>
          {loading ? 'Загрузка…' : 'Показать ещё'}
        </button>
      {/if}
      <span class="meta dim">загружено: {items.length}</span>
    </div>
  {/if}
</div>
