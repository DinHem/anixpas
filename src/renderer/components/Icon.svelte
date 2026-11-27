<script>
  /**
   * Единый набор иконок. Только контур, stroke-width 1.6, сетка 24×24.
   * Цвет наследуется от текста (stroke: currentColor), поэтому иконки
   * одинаково работают в обычных, активных и приглушённых состояниях.
   */

  /** @type {{ name: string, size?: number, stroke?: number, class?: string }} */
  let { name, size = 18, stroke = 1.6, class: cls = '' } = $props();

  /** Одиночные контуры. */
  const paths = {
    catalog: 'M4 5h6v6H4zM14 5h6v6h-6zM4 13h6v6H4zM14 13h6v6h-6z',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4.2-4.2',
    bookmark: 'M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z',
    info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8.2v.4',
    grid: 'M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v5H4zM13 14h7v5h-7z',
    list: 'M4 6h16M4 12h16M4 18h16',
    more: 'M12 5.5v.1M12 12v.1M12 18.5v.1',
    play: 'M8 5.5v13l11-6.5-11-6.5z',
    pause: 'M9 5.5v13M15 5.5v13',
    prev: 'M18 6v12L9 12l9-6zM6 5v14',
    next: 'M6 6v12l9-6-9-6zM18 5v14',
    back: 'M20 12H4M10 6l-6 6 6 6',
    star: 'M12 3.6l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9z',
    check: 'M4 12.5l5 5L20 6.5',
    download: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M4 19h16',
    volume: 'M4 9.5h3L12 5v14L7 14.5H4zM16 9a4 4 0 0 1 0 6M18.7 6.3a7.5 7.5 0 0 1 0 11.4',
    mute: 'M4 9.5h3L12 5v14L7 14.5H4zM16.5 9.5l5 5M21.5 9.5l-5 5',
    external: 'M14 4h6v6M20 4l-8.5 8.5M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
    'chevron-right': 'M9 5l7 7-7 7',
    'chevron-down': 'M5 9l7 7 7-7',
    fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    filter: 'M4 6h16M7 12h10M10 18h4',
    user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4.5 20a7.5 7.5 0 0 1 15 0',
    logout: 'M14 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8M17 8.5l3.5 3.5L17 15.5M20.5 12H10',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3.2 2',
    calendar: 'M4 7h16v13H4zM4 11h16M8.5 4v4M15.5 4v4',
    close: 'M6 6l12 12M18 6L6 18',
  };

  let path = $derived(paths[name] || '');
  let cssClass = $derived(`icon ${name === 'spinner' ? 'spin' : ''} ${cls}`);
</script>

<svg
  class={cssClass}
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === 'star-filled'}
    <path
      d={paths.star}
      fill="currentColor"
      stroke="currentColor"
      stroke-width={stroke}
    />
  {:else if name === 'spinner'}
    <circle cx="12" cy="12" r="8" opacity="0.25" />
    <path d="M20 12a8 8 0 0 0-8-8" />
  {:else}
    <path d={path} />
  {/if}
</svg>

<style>
  .icon {
    flex: none;
    display: block;
  }

  /* Единственная анимация набора — ожидание внутри кнопки. */
  .icon.spin {
    animation: icon-spin 900ms linear infinite;
  }

  @keyframes icon-spin {
    to {
      rotate: 360deg;
    }
  }
</style>
