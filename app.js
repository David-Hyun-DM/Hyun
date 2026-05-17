/* ══════════════════════════════════════════════
   맛집 찾기 — 앱 로직
   카카오맵 API + PWA + 즐겨찾기 + 바텀시트
══════════════════════════════════════════════ */

/* ── 상수 ────────────────────────────────────── */
const RADIUS_VALUES  = [0, 500, 1000, 2000, 3000];  // 0 = 자동
const STORAGE_FAV    = 'matzip_fav_v2';
const STORAGE_RECENT = 'matzip_recent_v2';
const STORAGE_LOCS   = 'matzip_locs_v2';
const MAX_RECENT     = 8;
const MAX_RECENT_LOC = 5;

const TYPE_KW = {
  '고기':'고기', '해물':'해산물', '탕/국':'탕', '면':'면',
  '구이':'구이', '찜/조림':'찜', '전골/샤브':'전골',
  '튀김/전':'튀김', '덮밥':'덮밥', '분식':'분식'
};
const PURPOSE_KW = {
  '접대':'맛집', '배부름':'', '데이트':'분위기좋은',
  '가족모임':'가족', '회식':'단체', '간단식사':'',
  '특별한날':'유명한', '혼밥':'1인'
};
const PRICE_KW = { 1:'저렴한', 2:'', 3:'', 4:'고급', 5:'파인다이닝' };
const BASE_RADIUS = { 1:500, 2:800, 3:1200, 5:1500, 10:2000 };
const PURPOSE_BONUS = { '접대':400, '특별한날':300, '간단식사':-200, '혼밥':-100 };
const CATEGORY_ICON = {
  '한식':'🍚', '일식':'🍱', '중식':'🥢', '양식':'🍝',
  '카페':'☕', '패스트푸드':'🍔', '분식':'🌮', default:'🍽️'
};

/* ── 상태 ────────────────────────────────────── */
let map, ps, geocoder, infowindow;
let gpsOverlay  = null;
let markers     = [];
let curPosition = null;   // { lat, lng, label }
let curResults  = [];
let curPagination = null;
let detailPlace   = null;
let favorites  = loadJSON(STORAGE_FAV,    []);
let recentSearch = loadJSON(STORAGE_RECENT, []);
let recentLocs = loadJSON(STORAGE_LOCS,   []);
let addrDebounce = null;

/* ── 초기화 ──────────────────────────────────── */
window.onload = () => {
  if (typeof kakao === 'undefined') {
    document.getElementById('apiGuide').classList.remove('hidden');
    return;
  }
  let started = false;
  function doInit() {
    if (started) return;
    started = true;
    try {
      initMap();
      initSheet();
      initSlider();
      renderRecent();
      renderRecentLocs();
      renderFavorites();
      registerSW();
    } catch(e) {
      document.getElementById('apiGuide').classList.remove('hidden');
    }
  }
  kakao.maps.load(doInit);
  setTimeout(doInit, 1500);
};

function initMap() {
  const container = document.getElementById('map');
  map = new kakao.maps.Map(container, {
    center: new kakao.maps.LatLng(37.5665, 126.9780),
    level: 5
  });
  ps        = new kakao.maps.services.Places();
  geocoder  = new kakao.maps.services.Geocoder();
  infowindow = new kakao.maps.InfoWindow({ zIndex: 10 });

  map.addControl(new kakao.maps.MapTypeControl(), kakao.maps.ControlPosition.TOPRIGHT);
  map.addControl(new kakao.maps.ZoomControl(),    kakao.maps.ControlPosition.RIGHT);
  kakao.maps.event.addListener(map, 'click', () => infowindow.close());
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

/* ── 탭 전환 ─────────────────────────────────── */
function switchTab(btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  btn.classList.add('active');
  const viewId = btn.dataset.view;
  document.getElementById(viewId).classList.add('active');

  // 지도 뷰 전환 시 지도 크기 재계산
  if (viewId === 'viewMap') {
    setTimeout(() => map && map.relayout(), 50);
  }
}

function goToMapTab() {
  const mapTab = document.querySelector('.tab[data-view="viewMap"]');
  if (mapTab) switchTab(mapTab);
}

/* ── 위치 모달 ───────────────────────────────── */
function openLocModal() {
  document.getElementById('locModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('addrInput').focus(), 300);
}
function closeLocModal() {
  document.getElementById('locModal').classList.add('hidden');
  document.getElementById('addrInput').value = '';
  document.getElementById('addrResults').innerHTML = '';
}

function useGPS() {
  if (!navigator.geolocation) { showToast('이 브라우저는 위치 서비스를 지원하지 않습니다.'); return; }
  showLoading('📡 현재 위치를 가져오고 있습니다...');

  // 8초 강제 타임아웃 (브라우저 타임아웃이 안 걸릴 경우 대비)
  const fallback = setTimeout(() => {
    hideLoading();
    showToast('위치를 가져오지 못했습니다. 주소를 직접 입력해주세요.');
  }, 8000);

  navigator.geolocation.getCurrentPosition(
    pos => {
      clearTimeout(fallback);
      const { latitude: lat, longitude: lng } = pos.coords;

      // 주소 변환 실패 대비 3초 타임아웃
      const addrFallback = setTimeout(() => {
        hideLoading();
        applyPosition(lat, lng, `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        saveRecentLoc(lat, lng, `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        closeLocModal();
      }, 3000);

      geocoder.coord2RegionCode(lng, lat, (result, status) => {
        clearTimeout(addrFallback);
        hideLoading();
        const label = (status === kakao.maps.services.Status.OK && result[0])
          ? result[0].address_name
          : `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        applyPosition(lat, lng, label);
        saveRecentLoc(lat, lng, label);
        closeLocModal();
      });
    },
    err => {
      clearTimeout(fallback);
      hideLoading();
      const msg = { 1:'위치 권한을 허용해주세요.', 2:'위치를 가져올 수 없습니다.', 3:'위치 요청 시간 초과.' };
      showToast(msg[err.code] || '위치 오류');
    },
    { timeout: 7000, enableHighAccuracy: false, maximumAge: 60000 }
  );
}

function debounceAddrSearch() {
  clearTimeout(addrDebounce);
  addrDebounce = setTimeout(addrSearch, 400);
}

function addrSearch() {
  const q = document.getElementById('addrInput').value.trim();
  if (!q) { document.getElementById('addrResults').innerHTML = ''; return; }

  ps.keywordSearch(q, (places, status) => {
    const el = document.getElementById('addrResults');
    if (status !== kakao.maps.services.Status.OK || !places.length) {
      el.innerHTML = '<div style="padding:12px;font-size:13px;color:var(--gray3)">검색 결과가 없습니다.</div>';
      return;
    }
    el.innerHTML = places.slice(0, 6).map(p => `
      <div class="addr-item" onclick="selectAddr(${p.y}, ${p.x}, '${esc(p.place_name)}')">
        <span class="addr-item-icon">${getCatIcon(p.category_name)}</span>
        <div class="addr-item-info">
          <div class="addr-item-name">${p.place_name}</div>
          <div class="addr-item-sub">${p.address_name}</div>
        </div>
      </div>
    `).join('');
  });
}

function selectAddr(lat, lng, label) {
  applyPosition(parseFloat(lat), parseFloat(lng), label);
  saveRecentLoc(parseFloat(lat), parseFloat(lng), label);
  closeLocModal();
}

function applyPosition(lat, lng, label) {
  curPosition = { lat, lng, label };
  document.getElementById('locLabel').textContent = label;
  moveTo(lat, lng, 5);
  placeGPSDot(lat, lng);
}

function placeGPSDot(lat, lng) {
  if (gpsOverlay) gpsOverlay.setMap(null);
  gpsOverlay = new kakao.maps.CustomOverlay({
    position: new kakao.maps.LatLng(lat, lng),
    content: '<div class="gps-dot"></div>',
    zIndex: 5
  });
  gpsOverlay.setMap(map);
}

function saveRecentLoc(lat, lng, label) {
  recentLocs = recentLocs.filter(l => l.label !== label);
  recentLocs.unshift({ lat, lng, label });
  if (recentLocs.length > MAX_RECENT_LOC) recentLocs.pop();
  saveJSON(STORAGE_LOCS, recentLocs);
  renderRecentLocs();
}

function renderRecentLocs() {
  const wrap = document.getElementById('recentLocWrap');
  const el   = document.getElementById('recentLocs');
  if (!recentLocs.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  el.innerHTML = recentLocs.map(l => `
    <div class="addr-item" onclick="selectAddr(${l.lat}, ${l.lng}, '${esc(l.label)}')">
      <span class="addr-item-icon">🕐</span>
      <div class="addr-item-info">
        <div class="addr-item-name">${l.label}</div>
      </div>
    </div>
  `).join('');
}

/* ── 검색 ────────────────────────────────────── */
function doSearch() {
  if (!curPosition) { openLocModal(); return; }

  const f = getFilters();
  const kw = buildKeyword(f);
  const radius = getRadius(f);

  showLoading(`🔍 "${kw}" 검색 중...`);
  clearMarkers();
  curResults = [];
  curPagination = null;

  addRecentSearch(kw);

  // 8초 강제 타임아웃
  const searchTimer = setTimeout(() => {
    hideLoading();
    showToast('검색 응답이 없습니다. 잠시 후 다시 시도해주세요.');
  }, 8000);

  const opts = {
    location: new kakao.maps.LatLng(curPosition.lat, curPosition.lng),
    radius,
    sort: kakao.maps.services.SortBy.DISTANCE,
    category_group_code: 'FD6'
  };

  ps.keywordSearch(kw, (places, status, pagination) => {
    clearTimeout(searchTimer);
    hideLoading();
    if (status === kakao.maps.services.Status.OK) {
      curResults = places;
      curPagination = pagination;
      renderResults(places, f.avoids);
      goToMapTab();
      setSheetState('half');
    } else if (status === kakao.maps.services.Status.ZERO_RESULT) {
      goToMapTab();
      setSheetTitle('검색 결과 없음', '');
      setSheetEmpty('😔 검색 결과가 없습니다.\n필터를 변경하거나 위치를 바꿔보세요.');
    } else {
      showToast('검색 중 오류가 발생했습니다.');
    }
  }, opts);
}

/* 이 지역에서 검색 (지도 중심 기준) */
function searchHere() {
  const center = map.getCenter();
  const prev = curPosition;
  curPosition = { lat: center.getLat(), lng: center.getLng(), label: prev ? prev.label : '현재 지도 위치' };
  doSearch();
}

function recenterMap() {
  if (!curPosition) { openLocModal(); return; }
  moveTo(curPosition.lat, curPosition.lng, 5);
}

function getFilters() {
  return {
    menu:    document.querySelector('input[name="menu"]:checked')?.value    || '한식',
    types:   [...document.querySelectorAll('input[name="type"]:checked')].map(e => e.value),
    purpose: document.querySelector('input[name="purpose"]:checked')?.value || '배부름',
    people:  parseInt(document.querySelector('input[name="people"]:checked')?.value || 2),
    price:   parseInt(document.querySelector('input[name="price"]:checked')?.value  || 2),
    avoids:  [...document.querySelectorAll('input[name="avoid"]:checked')].map(e => e.value),
    radiusOverride: RADIUS_VALUES[parseInt(document.getElementById('radiusSlider').value)]
  };
}

function buildKeyword(f) {
  const parts = [];
  if (f.menu !== '기타') parts.push(f.menu);
  if (f.types.length)    parts.push(TYPE_KW[f.types[0]] || f.types[0]);
  const pkw  = PURPOSE_KW[f.purpose] || '';
  if (pkw)               parts.push(pkw);
  const prkw = PRICE_KW[f.price]     || '';
  if (prkw)              parts.push(prkw);
  return parts.join(' ') || '음식점';
}

function getRadius(f) {
  if (f.radiusOverride > 0) return f.radiusOverride;
  const base = BASE_RADIUS[f.people] || 1000;
  const bonus = PURPOSE_BONUS[f.purpose] || 0;
  return Math.max(300, Math.min(base + bonus, 3000));
}

function resetFilters() {
  document.querySelector('input[name="menu"][value="한식"]').checked      = true;
  document.querySelector('input[name="purpose"][value="배부름"]').checked = true;
  document.querySelector('input[name="people"][value="2"]').checked       = true;
  document.querySelector('input[name="price"][value="2"]').checked        = true;
  document.querySelectorAll('input[name="type"], input[name="avoid"]').forEach(e => e.checked = false);
  document.getElementById('radiusSlider').value = 0;
  updateRadiusLabel(0);
  showToast('필터가 초기화되었습니다.');
}

/* ── 결과 렌더링 ──────────────────────────────── */
function renderResults(places, avoids = []) {
  const title = buildKeyword(getFilters());
  setSheetTitle(title, `${places.length}개`);

  const sheetBody = document.getElementById('sheetBody');
  const sheetEmpty = document.getElementById('sheetEmpty');
  const moreWrap = document.getElementById('sheetMoreWrap');
  if (sheetBody) sheetBody.innerHTML = '';
  if (sheetEmpty) sheetEmpty.style.display = 'none';

  const bounds = new kakao.maps.LatLngBounds();

  // 피해야할것 경고
  if (avoids.length && sheetBody) {
    const warn = document.createElement('div');
    warn.style.cssText = 'margin:6px 4px 4px;padding:10px 12px;background:#FFF7ED;border-left:3px solid #F59E0B;border-radius:8px;font-size:12px;color:#92400E;';
    warn.textContent = `⚠️ 피해야할것 (${avoids.join(', ')}) — 식당에 직접 문의하세요.`;
    sheetBody.appendChild(warn);
  }

  places.forEach((place, i) => {
    const lat  = parseFloat(place.y);
    const lng  = parseFloat(place.x);
    const dist = curPosition ? haversine(curPosition.lat, curPosition.lng, lat, lng) : 0;

    makeMarker(place, i, lat, lng, dist);
    bounds.extend(new kakao.maps.LatLng(lat, lng));

    if (sheetBody) {
      const card = makeCard(place, i, dist);
      sheetBody.appendChild(card);
    }
  });

  if (gpsOverlay) bounds.extend(gpsOverlay.getPosition());
  map.setBounds(bounds);

  if (moreWrap) {
    moreWrap.style.display = (curPagination && curPagination.hasNextPage) ? 'block' : 'none';
  }
}

function loadMore() {
  if (curPagination && curPagination.hasNextPage) {
    showLoading('더 불러오는 중...');
    curPagination.nextPage();
  }
}

function makeCard(place, i, dist) {
  const card = document.createElement('div');
  card.className = 'res-card';
  card.id = `card-${i}`;
  const isFav = isFavorite(place.id);

  card.innerHTML = `
    <div class="res-num">${i + 1}</div>
    <div class="res-info">
      <div class="res-name">${place.place_name}</div>
      <div class="res-cat">${shortCat(place.category_name)}</div>
      <div class="res-meta">
        <span class="res-dist">📍 ${fmtDist(dist)}</span>
        <span class="res-addr" title="${place.address_name}">${place.address_name}</span>
        ${place.phone ? `<span class="res-phone">📞 <a href="tel:${place.phone}" onclick="event.stopPropagation()">${place.phone}</a></span>` : ''}
      </div>
    </div>
    <div class="res-actions">
      <button class="fav-btn-sm ${isFav ? 'on' : ''}"
        onclick="event.stopPropagation(); quickFav(this, ${JSON.stringify(place).replace(/"/g, '&quot;')})"
        title="${isFav ? '즐겨찾기 해제' : '즐겨찾기 추가'}">
        ${isFav ? '❤️' : '🤍'}
      </button>
      ${place.place_url ? `<a class="map-btn-sm" href="${place.place_url}" target="_blank" onclick="event.stopPropagation()" title="카카오맵에서 보기">🗺️</a>` : ''}
    </div>
  `;

  card.addEventListener('click', () => openDetail(place, dist, i));
  return card;
}

/* ── 마커 ─────────────────────────────────────── */
function makeMarker(place, i, lat, lng, dist) {
  const imgData = makeMarkerImage(i + 1);
  const imgSize = new kakao.maps.Size(32, 42);
  const imgOpt  = { offset: new kakao.maps.Point(16, 42) };
  const marker  = new kakao.maps.Marker({
    position: new kakao.maps.LatLng(lat, lng),
    map,
    title: place.place_name,
    image: new kakao.maps.MarkerImage(imgData, imgSize, imgOpt)
  });

  kakao.maps.event.addListener(marker, 'click', () => {
    openInfoWindow(marker, place, dist);
    highlightCard(i);
  });

  markers.push(marker);
  return marker;
}

function makeMarkerImage(n) {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 42;
  const ctx = c.getContext('2d');
  ctx.beginPath();
  ctx.arc(16, 15, 13, 0, Math.PI * 2);
  ctx.fillStyle = '#FF6B35';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(10, 24); ctx.lineTo(22, 24); ctx.lineTo(16, 40);
  ctx.closePath();
  ctx.fillStyle = '#FF6B35';
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${n > 9 ? 10 : 12}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), 16, 15);
  return c.toDataURL();
}

function openInfoWindow(marker, place, dist) {
  infowindow.setContent(`
    <div class="iw">
      <div class="iw-name">${place.place_name}</div>
      <div class="iw-cat">${shortCat(place.category_name)}</div>
      ${dist ? `<div class="iw-dist">📍 ${fmtDist(dist)}</div>` : ''}
      <div class="iw-addr">${place.address_name}</div>
      ${place.place_url ? `<a class="iw-link" href="${place.place_url}" target="_blank">카카오맵에서 보기 →</a>` : ''}
    </div>
  `);
  infowindow.open(map, marker);
}

function highlightCard(i) {
  document.querySelectorAll('.res-card').forEach(c => c.classList.remove('highlighted'));
  const card = document.getElementById(`card-${i}`);
  if (card) {
    card.classList.add('highlighted');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function clearMarkers() {
  markers.forEach(m => m.setMap(null));
  markers = [];
  infowindow?.close();
}

/* ── 상세 모달 ───────────────────────────────── */
function openDetail(place, dist, cardIdx) {
  detailPlace = { ...place, dist, cardIdx };
  document.getElementById('detailName').textContent = place.place_name;
  document.getElementById('detailCat').textContent  = shortCat(place.category_name);
  document.getElementById('detailAddr').textContent = place.address_name;

  const phoneRow = document.getElementById('detailPhoneRow');
  if (place.phone) {
    phoneRow.style.display = 'flex';
    const a = document.getElementById('detailPhone');
    a.textContent = place.phone;
    a.href = `tel:${place.phone}`;
  } else {
    phoneRow.style.display = 'none';
  }

  const distRow = document.getElementById('detailDistRow');
  if (dist) {
    distRow.style.display = 'flex';
    document.getElementById('detailDist').textContent = fmtDist(dist);
  } else {
    distRow.style.display = 'none';
  }

  const favBtn = document.getElementById('detailFavBtn');
  const saved  = isFavorite(place.id);
  favBtn.textContent = saved ? '💔 저장 해제' : '❤️ 즐겨찾기';
  favBtn.className   = `detail-btn fav-btn${saved ? ' saved' : ''}`;

  document.getElementById('detailModal').classList.remove('hidden');
}

function closeDetail() {
  document.getElementById('detailModal').classList.add('hidden');
  detailPlace = null;
}

function openNavigation() {
  if (!detailPlace) return;
  const url = `https://map.kakao.com/link/to/${encodeURIComponent(detailPlace.place_name)},${detailPlace.y},${detailPlace.x}`;
  window.open(url, '_blank');
}

async function sharePlace() {
  if (!detailPlace) return;
  const text = `${detailPlace.place_name}\n${detailPlace.address_name}${detailPlace.phone ? '\n' + detailPlace.phone : ''}`;
  const url  = detailPlace.place_url || `https://map.kakao.com/`;
  if (navigator.share) {
    try { await navigator.share({ title: detailPlace.place_name, text, url }); } catch {}
  } else {
    await navigator.clipboard.writeText(`${text}\n${url}`).catch(() => {});
    showToast('클립보드에 복사되었습니다!');
  }
}

function toggleFavFromDetail() {
  if (!detailPlace) return;
  const saved = toggleFavorite(detailPlace);
  const favBtn = document.getElementById('detailFavBtn');
  favBtn.textContent = saved ? '💔 저장 해제' : '❤️ 즐겨찾기';
  favBtn.className   = `detail-btn fav-btn${saved ? ' saved' : ''}`;

  // 카드 하트 아이콘도 갱신
  if (detailPlace.cardIdx !== undefined) {
    const card = document.getElementById(`card-${detailPlace.cardIdx}`);
    const btn  = card?.querySelector('.fav-btn-sm');
    if (btn) { btn.textContent = saved ? '❤️' : '🤍'; btn.classList.toggle('on', saved); }
  }
  showToast(saved ? '즐겨찾기에 저장했습니다!' : '즐겨찾기에서 제거했습니다.');
}

function quickFav(btn, place) {
  const saved = toggleFavorite(place);
  btn.textContent = saved ? '❤️' : '🤍';
  btn.classList.toggle('on', saved);
  showToast(saved ? '즐겨찾기에 저장!' : '즐겨찾기 해제');
}

function copyText(elId) {
  const t = document.getElementById(elId).textContent;
  navigator.clipboard.writeText(t).then(() => showToast('복사했습니다!')).catch(() => {});
}

/* ── 즐겨찾기 ────────────────────────────────── */
function toggleFavorite(place) {
  const idx = favorites.findIndex(f => f.id === place.id);
  if (idx >= 0) { favorites.splice(idx, 1); }
  else          { favorites.unshift({ id: place.id, place_name: place.place_name, category_name: place.category_name, address_name: place.address_name, phone: place.phone, place_url: place.place_url, y: place.y, x: place.x, savedAt: Date.now() }); }
  saveJSON(STORAGE_FAV, favorites);
  renderFavorites();
  return idx < 0;
}

function isFavorite(id) { return favorites.some(f => f.id === id); }

function renderFavorites() {
  const el = document.getElementById('favList');
  document.getElementById('favCount').textContent = `${favorites.length}개`;
  if (!favorites.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🍽️</div><p>즐겨찾기한 맛집이 없습니다.<br>결과에서 ❤️ 버튼을 눌러 저장하세요.</p></div>`;
    return;
  }
  el.innerHTML = favorites.map(p => `
    <div class="fav-card" onclick="openFavDetail('${p.id}')">
      <span class="fav-icon">${getCatIcon(p.category_name)}</span>
      <div class="fav-info">
        <div class="fav-name">${p.place_name}</div>
        <div class="fav-meta">${shortCat(p.category_name)} · ${p.address_name}</div>
      </div>
      <button class="fav-del" onclick="event.stopPropagation(); removeFav('${p.id}')" title="즐겨찾기 제거">💔</button>
    </div>
  `).join('');
}

function removeFav(id) {
  favorites = favorites.filter(f => f.id !== id);
  saveJSON(STORAGE_FAV, favorites);
  renderFavorites();
  showToast('즐겨찾기에서 제거했습니다.');
}

function openFavDetail(id) {
  const p = favorites.find(f => f.id === id);
  if (p) openDetail(p, 0, undefined);
}

/* ── 최근 검색 ───────────────────────────────── */
function addRecentSearch(kw) {
  recentSearch = recentSearch.filter(r => r !== kw);
  recentSearch.unshift(kw);
  if (recentSearch.length > MAX_RECENT) recentSearch.pop();
  saveJSON(STORAGE_RECENT, recentSearch);
  renderRecent();
}

function renderRecent() {
  const sec = document.getElementById('recentSection');
  const el  = document.getElementById('recentChips');
  if (!recentSearch.length) { sec.style.display = 'none'; return; }
  sec.style.display = 'block';
  el.innerHTML = recentSearch.map(r => `
    <div class="chip" onclick="applyRecentSearch('${esc(r)}')">
      <span>${r}</span>
      <span class="chip-del" onclick="event.stopPropagation(); removeRecent('${esc(r)}')">✕</span>
    </div>
  `).join('');
}

function applyRecentSearch(kw) {
  // 최근 검색 키워드를 메뉴 필드에 반영하고 검색
  doSearch();
}

function removeRecent(kw) {
  recentSearch = recentSearch.filter(r => r !== kw);
  saveJSON(STORAGE_RECENT, recentSearch);
  renderRecent();
}

/* ── 바텀 시트 ───────────────────────────────── */
function initSheet() {
  const handle = document.getElementById('sheetHandle');
  const sheet  = document.getElementById('sheet');
  let dragging = false, startY = 0, startH = 0;

  const onStart = e => {
    dragging = true; startY = getClientY(e); startH = sheet.offsetHeight;
    sheet.classList.add('dragging');
  };
  const onMove = e => {
    if (!dragging) return;
    const delta = startY - getClientY(e);
    const max = window.innerHeight * 0.86;
    sheet.style.height = Math.max(72, Math.min(max, startH + delta)) + 'px';
  };
  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('dragging');
    sheet.style.height = '';
    const h = sheet.offsetHeight;
    const half = window.innerHeight * 0.48;
    const full = window.innerHeight * 0.86;
    if (h < 160)          setSheetState('peek');
    else if (h < half * 0.7) setSheetState('half');
    else if (h < full * 0.7) setSheetState('half');
    else                   setSheetState('full');
  };

  handle.addEventListener('mousedown',  onStart);
  handle.addEventListener('touchstart', onStart, { passive: true });
  document.addEventListener('mousemove',  onMove);
  document.addEventListener('touchmove',  onMove, { passive: true });
  document.addEventListener('mouseup',    onEnd);
  document.addEventListener('touchend',   onEnd);
}

function getClientY(e) { return e.touches ? e.touches[0].clientY : e.clientY; }

function setSheetState(state) {
  const sheet = document.getElementById('sheet');
  sheet.classList.remove('half', 'full');
  if (state === 'half' || state === 'full') sheet.classList.add(state);
}

function setSheetTitle(title, count) {
  document.getElementById('sheetTitle').textContent = title;
  document.getElementById('sheetCount').textContent = count;
}

function setSheetEmpty(msg) {
  document.getElementById('sheetBody').innerHTML = `<div class="sheet-empty"><p>${msg}</p></div>`;
  document.getElementById('sheetMoreWrap').style.display = 'none';
}

/* ── 반경 슬라이더 ───────────────────────────── */
function initSlider() {
  const slider = document.getElementById('radiusSlider');
  const updateGradient = v => {
    const pct = (v / 4) * 100;
    slider.style.background = `linear-gradient(to right, var(--primary) ${pct}%, var(--gray4) ${pct}%)`;
  };
  slider.addEventListener('input', e => updateGradient(e.target.value));
  updateGradient(0);
}

function updateRadiusLabel(v) {
  const labels = ['자동', '500m', '1km', '2km', '3km'];
  document.getElementById('radiusLabel').textContent = labels[v] || '자동';
}

/* ── 유틸 ────────────────────────────────────── */
function moveTo(lat, lng, level) {
  map.setCenter(new kakao.maps.LatLng(lat, lng));
  map.setLevel(level);
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const f1 = lat1 * Math.PI / 180, f2 = lat2 * Math.PI / 180;
  const df = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function fmtDist(m) { return m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`; }

function shortCat(cat) {
  if (!cat) return '음식점';
  const parts = cat.split(' > ');
  return parts[parts.length - 1] || cat;
}

function getCatIcon(cat) {
  if (!cat) return CATEGORY_ICON.default;
  for (const [k, v] of Object.entries(CATEGORY_ICON)) {
    if (cat.includes(k)) return v;
  }
  return CATEGORY_ICON.default;
}

function esc(str) { return str ? str.replace(/'/g, "\\'").replace(/"/g, '\\"') : ''; }

/* ── 로딩 / 토스트 ───────────────────────────── */
function showLoading(text = '맛집을 찾고 있습니다...') {
  document.getElementById('loadingText').textContent = text;
  document.getElementById('loading').classList.remove('hidden');
}
function hideLoading() { document.getElementById('loading').classList.add('hidden'); }

let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  t.style.animation = 'none';
  requestAnimationFrame(() => { t.style.animation = ''; });
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

/* ── localStorage ─────────────────────────────── */
function loadJSON(key, def) {
  try { return JSON.parse(localStorage.getItem(key)) || def; } catch { return def; }
}
function saveJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
