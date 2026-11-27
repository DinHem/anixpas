<script>
  /**
   * Виртуализация сетки: в DOM живут только карточки у экрана.
   *
   * Зачем: каждый постер занимает ~2 МБ в декодированном виде. 300 карточек
   * в разметке — это ~600 МБ только на картинки (см. docs/02-progress.md, этап 13).
   * Данные остаются все, выгружается только разметка.
   *
   * Ожидает, что высота карточек одинаковая (заголовок занимает фиксированные
   * две строки), иначе строки «поедут».
   */
  import { onMount } from 'svelte';

  /**
   * @type {{
   *   items: any[],
   *   item: any,
   *   gapY?: number,
   *   overscan?: number,
   *   estimate?: number,
   *   class?: string,
   * }}
   */
  let { items, item, gapY = 22, overscan = 2, estimate = 340, class: cls = 'grid' } = $props();

  /** @type {HTMLElement|null} */
  let host = $state(null);
  /** @type {HTMLElement|null} */
  let gridEl = $state(null);

  let columns = $state(1);
  let rowHeight = $state(estimate);
  let visibleStart = $state(0);
  let viewport = $state(900);

  const stride = $derived(rowHeight + gapY);
  const totalRows = $derived(Math.max(1, Math.ceil(items.length / columns)));

  const firstRow = $derived(Math.max(0, Math.floor(visibleStart / stride) - overscan));
  const lastRow = $derived(
    Math.min(totalRows, Math.ceil((visibleStart + viewport) / stride) + overscan)
  );

  const slice = $derived(items.slice(firstRow * columns, lastRow * columns));
  const topSpace = $derived(firstRow * stride);
  const bottomSpace = $derived(Math.max(0, (totalRows - lastRow) * stride));

  /** Пересчитать сетку: колонки, высота строки. */
  function measure() {
    if (!gridEl || !host) return;

    // Скрытый экран (keepalive) размеров не имеет — ждём активации.
    if (host.getBoundingClientRect().width < 1) return;

    const styles = getComputedStyle(gridEl);
    const cols = styles.gridTemplateColumns.split(' ').filter((part) => part.endsWith('px')).length;
    if (cols > 0) columns = cols;

    const first = gridEl.firstElementChild;
    if (first) {
      const height = first.getBoundingClientRect().height;
      if (height > 10) rowHeight = height;
    }
  }

  /** Пересчитать видимое окно. */
  function updateWindow() {
    if (!host) return;

    const scroller = host.closest('.main');
    if (!scroller) return;

    const hostRect = host.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();

    // Положение сетки внутри прокручиваемого содержимого.
    const offset = hostRect.top - scrollerRect.top + scroller.scrollTop;
    visibleStart = scroller.scrollTop - offset;
    viewport = scroller.clientHeight;
  }

  onMount(() => {
    const scroller = host?.closest('.main');
    if (!scroller) return;

    const onChange = () => {
      updateWindow();
      measure();
    };

    onChange();
    scroller.addEventListener('scroll', updateWindow, { passive: true });
    window.addEventListener('resize', onChange);

    // Размеры появляются и при переключении разделов (снятый display:none).
    const observer = new ResizeObserver(onChange);
    if (host) observer.observe(host);

    return () => {
      scroller.removeEventListener('scroll', updateWindow);
      window.removeEventListener('resize', onChange);
      observer.disconnect();
    };
  });

  // Данных стало больше — пересчитываем окно.
  $effect(() => {
    void items.length;
    updateWindow();
    measure();
  });
</script>

<div class="virtual-host" bind:this={host}>
  <div class="virtual-space" style="height:{topSpace}px"></div>

  <div class={cls} bind:this={gridEl}>
    {#each slice as entry (entry.id)}
      {@render item(entry)}
    {/each}
  </div>

  <div class="virtual-space" style="height:{bottomSpace}px"></div>
</div>
