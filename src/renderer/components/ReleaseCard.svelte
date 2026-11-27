<script>
  /**
   * Карточка тайтла для сеток: каталог, поиск, закладки, оценки, франшиза.
   *
   * Мета — как в оригинальном приложении: «14 из 24 эп · ★ 4.6».
   * Блок с названием и метой фиксированной высоты и выровнен по верху:
   * иначе у названий в одну строку мета уезжала вниз и появлялась дырка.
   */
  import Icon from './Icon.svelte';
  import { formatGrade, formatPremiere } from '../lib/format.js';

  /**
   * @type {{
   *   item: any,
   *   onOpen: (id: number) => void,
   *   onMenu?: (() => void)|null,
   *   badge?: { label: string, cls: string }|null,
   *   vote?: number,
   *   compact?: boolean,
   * }}
   */
  let { item, onOpen, onMenu = null, badge = null, vote = 0, compact = false } = $props();

  /** Анонс — вместо серий показываем дату премьеры. */
  const isAnnounced = $derived(item.status === 'Анонс');
  const premiere = $derived(isAnnounced ? formatPremiere(item) : '');

  /** «14 из 24 эп», «8 из ? эп» или «16 эп». */
  function episodesText(entry) {
    const released = Number(entry.episodesReleased) || 0;
    const total = Number(entry.episodesTotal) || 0;

    if (!released && !total) return '';
    if (total && released && total > released) return `${released} из ${total} эп`;
    if (!total && released) return `${released} из ? эп`;
    return `${total || released} эп`;
  }
</script>

<div class="card-wrap">
  <button class="card" class:compact onclick={() => onOpen(item.id)}>
    <div class="poster">
      {#if item.poster}
        <img src={item.poster} alt="" loading="lazy" referrerpolicy="no-referrer" />
      {:else}
        <div class="poster-empty">нет постера</div>
      {/if}

      {#if badge}
        <span class="poster-badge {badge.cls}">{badge.label}</span>
      {/if}

      {#if vote}
        <span class="poster-badge vote-badge">{vote} ★</span>
      {/if}
    </div>

    <div class="card-body">
      <div class="card-title">{item.title}</div>
      <div class="card-meta">
        {#if !compact && premiere}
          <span class="card-premiere">{premiere}</span>
        {:else if !compact}
          {#if episodesText(item)}
            <span class="card-episodes">{episodesText(item)}</span>
          {/if}
          {#if item.grade}
            <span class="card-grade">★ {formatGrade(item.grade)}</span>
          {/if}
        {/if}
      </div>
    </div>
  </button>

  {#if onMenu}
    <button class="card-menu" title="В список" onclick={onMenu}>
      <Icon name="more" size={16} stroke={2.4} />
    </button>
  {/if}
</div>
