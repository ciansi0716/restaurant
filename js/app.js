// ==========================================
// 🌟 Google Apps Script (試算表 API) 網址
// 🚨 請換成你部署後獲得的那串網址
// ==========================================
const GAS_URL = "https://script.google.com/macros/s/AKfycbzY78FVNqEzvUk83Z82Rvbjhyc1qQhfb2k9wSZtdk8E4ZNhKIujxh0v1-6WYwpSJtYWyA/exec";

const App = {
  map: null,
  placesService: null,
  markers: [],
  mapCenter: { lat: 25.0330, lng: 121.5654 }, 
  searchResults: [],
  visibleResults: [],
  lastSearchLocation: null, 
  
  userLocation: null,
  userMarker: null,
  
  userLists: { '未分類': [] },
  listEmojis: { '未分類': '🔖' },
  brandDatabase: {},
  brandMappings: {},
  activeListFilters: new Set(),
  
  currentDetailPlace: null,
  compassCandidates: [], 

  async init() {
    console.log("🚀 系統初始化中...");
    await this.loadData();
    this.initMap();
    
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => { 
          this.userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude }; 
          this.mapCenter = this.userLocation;
          if(this.map) {
            this.map.setCenter(this.mapCenter);
            this.updateUserMarker();
            this.performSearch(); 
          }
        },
        (err) => { console.warn("❌ 初始定位失敗：", err.message); },
        { enableHighAccuracy: true, timeout: 5000 }
      );

      navigator.geolocation.watchPosition(
        (pos) => {
          this.userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          if (this.map) this.updateUserMarker(); 
        },
        (err) => { console.warn("❌ 即時追蹤更新失敗：", err.message); },
        { enableHighAccuracy: true, maximumAge: 10000 }
      );
    }
  },

  updateUserMarker() {
    if (!this.userLocation) return;
    if (!this.userMarker) {
      this.userMarker = new google.maps.Marker({
        map: this.map,
        position: this.userLocation,
        title: "你的目前位置",
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#4285F4',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
        zIndex: 999 
      });
    } else {
      this.userMarker.setPosition(this.userLocation);
    }
  },

  centerToUserLocation() {
    if (this.userLocation && this.map) {
      this.map.setCenter(this.userLocation);
      this.map.setZoom(17);
      this.performSearch(this.userLocation); 
    } else {
      alert("📍 正在取得定位中，或請確認是否允許瀏覽器存取位置權限。");
    }
  },

  async loadData() {
    try {
      const response = await fetch(GAS_URL);
      const dataStr = await response.text();
      
      if (dataStr && dataStr.includes('brandDatabase')) {
        const data = JSON.parse(dataStr);
        this.userLists = data.userLists || { '未分類': [] };
        this.listEmojis = data.listEmojis || {}; // 先接收資料庫裡的設定
        this.brandDatabase = data.brandDatabase || {};
        this.brandMappings = data.brandMappings || {};
        console.log("✅ 成功從試算表載入資料！");
      }
    } catch (e) {
      console.warn("⚠️ 雲端讀取失敗，嘗試讀取本地備份資料", e);
      const local = localStorage.getItem('foodMapData');
      if (local) {
        const data = JSON.parse(local);
        this.userLists = data.userLists || { '未分類': [] };
        this.listEmojis = data.listEmojis || {};
        this.brandDatabase = data.brandDatabase || {};
        this.brandMappings = data.brandMappings || {};
      }
    }

    // 🌟 【自動修復防呆機制】：檢查所有清單，如果沒有專屬的 Emoji，就自動補上 🔖
    if (!this.listEmojis['未分類']) {
      this.listEmojis['未分類'] = '🔖';
    }
    for (let listName in this.userLists) {
      if (!this.listEmojis[listName]) {
        this.listEmojis[listName] = '🔖'; // 舊清單自動獲得預設圖示，就不會跑出 undefined 了
      }
    }
  },

  async saveData() {
    const data = {
      userLists: this.userLists,
      listEmojis: this.listEmojis,
      brandDatabase: this.brandDatabase,
      brandMappings: this.brandMappings
    };
    
    try { localStorage.setItem('foodMapData', JSON.stringify(data)); } catch(e){}

    if (GAS_URL.includes("script.google.com")) {
      try {
        fetch(GAS_URL, {
          method: "POST",
          body: JSON.stringify(data) 
        });
      } catch (error) {
        console.error("❌ 儲存至雲端失敗:", error);
      }
    }
  },

  getStarString(rating) {
    if (!rating) return '';
    const rounded = Math.max(1, Math.min(5, Math.round(rating))); 
    const full = '★'.repeat(rounded);
    const empty = '☆'.repeat(5 - rounded);
    return `<span style="color:#FFB800; font-size:14px; letter-spacing:1px; margin-left:6px;">${full}${empty}</span>`;
  },

  getLat(loc) { return typeof loc.lat === 'function' ? loc.lat() : loc.lat; },
  getLng(loc) { return typeof loc.lng === 'function' ? loc.lng() : loc.lng; },
  
  getDistance(loc1, loc2) {
    if (!loc1 || !loc2) return 9999;
    const lat1 = this.getLat(loc1);
    const lon1 = this.getLng(loc1);
    const lat2 = this.getLat(loc2);
    const lon2 = this.getLng(loc2);
    
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  },

  isInAnyList(placeId) {
    for (const listName in this.userLists) {
      if (this.userLists[listName].some(p => p.place_id === placeId)) return true;
    }
    return false;
  },

  initMap() {
    this.map = new google.maps.Map(document.getElementById("map"), {
      center: this.mapCenter,
      zoom: 15,
      mapTypeControl: false,
    });
    this.placesService = new google.maps.places.PlacesService(this.map);
    this.map.addListener('dragend', () => {
      document.getElementById('search-here-btn').style.display = 'block';
    });
    this.performSearch();
  },

  performSearch(specificLocation = null) {
    const keyword = document.getElementById('search-input').value || '餐廳|美食';
    const loc = specificLocation || this.mapCenter;
    this.lastSearchLocation = loc; 
    
    this.placesService.nearbySearch({ location: loc, radius: '50000', keyword: keyword }, (results, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK && results) {
        this.searchResults = results;
        document.getElementById('search-here-btn').style.display = 'none';
        this.rebuildMarkers();
        this.updateVisibleRestaurants();
      }
    });
  },

  searchInCurrentArea() {
    this.performSearch(this.map.getCenter());
  },

  rebuildMarkers() {
    this.markers.forEach(m => m.setMap(null));
    this.markers = [];
    const addedPlaceIds = new Set(); 

    this.activeListFilters.forEach(listName => {
      if(this.userLists[listName]) {
        this.userLists[listName].forEach(place => {
           if (!place.geometry || !place.geometry.location) return;
           if (addedPlaceIds.has(place.place_id)) return;
           
           const marker = new google.maps.Marker({ 
             map: this.map, 
             position: place.geometry.location, 
             title: `[${listName}] ${place.name}`,
             icon: {
               path: google.maps.SymbolPath.CIRCLE,
               scale: 14, 
               fillColor: '#FFFFFF', 
               fillOpacity: 1, 
               strokeWeight: 2, 
               strokeColor: '#FF7A00' 
             },
             label: { 
               text: this.listEmojis[listName] || '🔖', // 確保一定有圖示
               fontSize: '16px' 
             }, 
             zIndex: 1000 
           });
           
           marker.addListener('click', () => {
             this.map.setCenter(place.geometry.location);
             this.map.setZoom(17);
             this.openDetail(place);
           });
           this.markers.push(marker);
           addedPlaceIds.add(place.place_id);
        });
      }
    });

    this.searchResults.forEach(place => {
      if (addedPlaceIds.has(place.place_id)) return;
      
      const marker = new google.maps.Marker({
        map: this.map, 
        position: place.geometry.location, 
        title: place.name
      });
      marker.addListener('click', () => {
        this.map.setCenter(place.geometry.location);
        this.map.setZoom(17);
        this.openDetail(place);
      });
      this.markers.push(marker);
    });
  },

  updateVisibleRestaurants() {
    const onlyOpen = document.getElementById('open-now-toggle').checked;
    
    let filtered = this.searchResults.filter(p => {
      if (onlyOpen && (!p.opening_hours || !p.opening_hours.open_now)) return false;
      return true;
    });
    
    filtered.forEach(p => {
      p._saved = this.isInAnyList(p.place_id);
      p._distance = this.getDistance(this.lastSearchLocation, p.geometry.location);
    });

    filtered.sort((a, b) => {
      if (a._saved && !b._saved) return -1; 
      if (!a._saved && b._saved) return 1;  
      return a._distance - b._distance;     
    });

    this.visibleResults = filtered;
    
    document.getElementById('result-count').innerText = `顯示 ${this.visibleResults.length} 間餐廳`;
    const listContainer = document.getElementById('search-results-list');
    listContainer.innerHTML = '';
    
    this.visibleResults.forEach(place => {
      const div = document.createElement('div');
      div.className = 'restaurant-card';
      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div style="flex:1; padding-right:10px;">
            <strong style="font-size:16px;">${place.name}</strong> 
            ${place._saved ? '<span title="已存入清單" style="font-size:13px; margin-left:4px;">🔖</span>' : ''}<br>
            <small style="color:gray;">${place.vicinity || ''}</small>
          </div>
          <div style="text-align:right; min-width:60px;">
            <div>⭐️ ${place.rating || 'N/A'}</div>
            <small style="color:var(--primary); font-weight:bold;">${place._distance.toFixed(1)} km</small>
          </div>
        </div>
      `;
      
      div.onclick = () => { 
        this.map.setCenter(place.geometry.location); 
        this.map.setZoom(17); 
        this.openDetail(place); 
      };
      
      listContainer.appendChild(div);
    });
  },

  showFilterLayerModal() {
    let html = `<h3 style="margin-top:0">在地圖顯示清單圖層</h3>
                <p style="font-size:13px; color:gray; margin-top:-5px;">打勾後，這些餐廳的標記會一直顯示在地圖上。</p>`;
    Object.keys(this.userLists).forEach(listName => {
      const isChecked = this.activeListFilters.has(listName) ? 'checked' : '';
      const emoji = this.listEmojis[listName] || '🔖';
      html += `
        <label style="display:block; margin:15px 0; font-size:16px; cursor:pointer;">
          <input type="checkbox" ${isChecked} onchange="App.toggleFilter('${listName}', this.checked)" style="transform: scale(1.2); margin-right:10px;"> 
          ${emoji} ${listName} (${this.userLists[listName].length})
        </label>`;
    });
    html += `<div class="modal-actions"><button class="btn-primary" onclick="App.closeModal(); App.rebuildMarkers();">確定</button></div>`;
    this.openModal(html);
  },

  toggleFilter(listName, isChecked) {
    if (isChecked) {
      this.activeListFilters.add(listName);
    } else {
      this.activeListFilters.delete(listName);
    }
  },

  getBrandName(fullName) {
    if (this.brandMappings[fullName]) return this.brandMappings[fullName];
    return fullName.split(/[(（-]/)[0].trim();
  },

  openDetail(place) {
    this.currentDetailPlace = place;
    const bName = this.getBrandName(place.name);
    
    if (!this.brandDatabase[bName]) {
      this.brandDatabase[bName] = { visits: [], menu: [], overall: [], notes: [] };
    } else {
      if (!this.brandDatabase[bName].overall) this.brandDatabase[bName].overall = [];
    }
    
    document.getElementById('detail-title').innerText = place.name;
    document.getElementById('detail-brand').innerText = `📂 品牌：${bName}`;
    document.getElementById('detail-address').innerText = `📍 ${place.vicinity || '無地址'}`;
    
    document.getElementById('detail-rating').innerText = `⭐️ 評分: ${place.rating || 'N/A'}`;
    
    this.renderDetailData(bName);
    this.navigate('detail');
  },

  renderDetailData(bName) {
    const data = this.brandDatabase[bName];
    
    const visitsHtml = data.visits.map((date, idx) => `
      <li style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid #eee; padding-bottom:6px;">
        <span style="font-size:15px;">${date}</span>
        <div style="display:flex; gap:10px;">
          <button style="color:#007AFF; border:none; background:none; cursor:pointer; font-size:14px;" onclick="App.editData('visits', ${idx})">編輯</button>
          <button style="color:#F44336; border:none; background:none; cursor:pointer; font-size:14px;" onclick="App.deleteData('visits', ${idx})">刪除</button>
        </div>
      </li>`).join('');
    document.getElementById('detail-visits').innerHTML = visitsHtml ? `<ul style="padding-left:10px; margin:0; list-style:none;">${visitsHtml}</ul>` : '<p style="color:gray; font-size:14px; margin:0;">尚無紀錄</p>';
    
    const menuData = data.menu || [];
    const good = menuData.filter(m => m.category === '好吃');
    const normal = menuData.filter(m => m.category === '普通');
    const bad = menuData.filter(m => m.category === '難吃');

    const renderMenuCategory = (arr, title, emoji, color) => {
      return `
        <div style="margin-top:15px; border-left: 4px solid ${color}; padding-left: 12px; padding-right: 4px;">
          <h4 style="margin:0 0 10px 0; display:flex; align-items:center; justify-content:space-between;">
            <span style="color:${color}; display:flex; align-items:center; gap:5px; font-size:15px;">
              ${emoji} ${title} (${arr.length})
            </span>
            <button onclick="App.addMenuNote('${title}')" style="background:${color}; color:white; border:none; padding:5px 12px; border-radius:15px; font-weight:bold; font-size:13px; cursor:pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              + 新增
            </button>
          </h4>
          ${arr.length > 0 ? arr.map(m => {
            const realIdx = menuData.indexOf(m); 
            return `
              <div style="background:#F9FAFB; padding:10px; margin-bottom:8px; border-radius:6px; border:1px solid #EAEBEE;">
                <div style="display:flex; justify-content:space-between; align-items:center; font-weight:bold; font-size:14px; margin-bottom:4px;">
                  <span style="color:#333; display:flex; align-items:center;">
                    ${m.title} 
                    ${App.getStarString(m.rating)}
                  </span>
                  <div style="display:flex; gap:8px;">
                    <button style="color:#007AFF; border:none; background:none; cursor:pointer; padding:0; font-size:13px;" onclick="App.editData('menu', ${realIdx})">編輯</button>
                    <button style="color:#F44336; border:none; background:none; cursor:pointer; padding:0; font-size:13px;" onclick="App.deleteData('menu', ${realIdx})">刪除</button>
                  </div>
                </div>
                ${m.content ? `<p style="margin:0; font-size:13px; color:#666;">${m.content}</p>` : ''}
              </div>
            `;
          }).join('') : `<p style="color:gray; font-size:13px; margin:0;">尚無紀錄</p>`}
        </div>
      `;
    };

    let menuHtml = renderMenuCategory(good, '好吃', '', '#4CAF50');
    menuHtml += renderMenuCategory(normal, '普通', '', '#FF9800');
    menuHtml += renderMenuCategory(bad, '難吃', '', '#F44336');

    document.getElementById('detail-menu').innerHTML = menuHtml;

    const overallData = data.overall || [];
    const overallHtml = overallData.map((o, idx) => {
      const titleText = o.title || "總評價"; 
      return `
        <div style="background:#FFF9F5; padding:12px; margin-bottom:10px; border-radius:8px; border:1px solid #FFE4D6;">
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <strong style="color:#FF7A00; font-size:15px;">${titleText}</strong>
            <div style="display:flex; gap:10px;">
              <button style="color:#007AFF; border:none; background:none; cursor:pointer; padding:0; font-size:13px;" onclick="App.editData('overall', ${idx})">編輯</button>
              <button style="color:#F44336; border:none; background:none; cursor:pointer; padding:0; font-size:13px;" onclick="App.deleteData('overall', ${idx})">刪除</button>
            </div>
          </div>
          ${o.content ? `<p style="margin:0; font-size:14px; color:#333; line-height:1.5;">${o.content}</p>` : ''}
        </div>
      `;
    }).join('');
    
    document.getElementById('detail-overall').innerHTML = overallHtml || '<p style="color:gray; font-size:14px; margin-top:10px;">尚無總評價</p>';
  },

  checkAndMoveToUncategorized(place) {
    if (!place) return;
    let isInAnyList = false;
    for (const listName in this.userLists) {
      if (this.userLists[listName].some(p => p.place_id === place.place_id)) {
        isInAnyList = true;
        break;
      }
    }
    if (isInAnyList) return; 

    const bName = this.getBrandName(place.name);
    const data = this.brandDatabase[bName];
    
    if (data) {
      const hasMenu = data.menu && data.menu.length > 0;
      const hasVisits = data.visits && data.visits.length > 0;
      const hasOverall = data.overall && data.overall.length > 0;
      
      if (hasMenu || hasVisits || hasOverall) {
        if (!this.userLists['未分類']) {
          this.userLists['未分類'] = [];
          this.listEmojis['未分類'] = '🔖';
        }
        if (!this.userLists['未分類'].some(p => p.place_id === place.place_id)) {
          this.userLists['未分類'].push(place);
        }
      }
    }
  },

  ensureInList() {
    if (!this.currentDetailPlace) return;
    const place = this.currentDetailPlace;
    let isInAnyList = false;
    for (const listName in this.userLists) {
      if (this.userLists[listName].some(p => p.place_id === place.place_id)) {
        isInAnyList = true;
        break;
      }
    }
    if (!isInAnyList) {
      if (!this.userLists['未分類']) {
        this.userLists['未分類'] = [];
        this.listEmojis['未分類'] = '🔖';
      }
      this.userLists['未分類'].push(place);
    }
  },

  openInGoogleMaps() {
    if (!this.currentDetailPlace) return;
    const place = this.currentDetailPlace;
    let url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}`;
    if (place.place_id) {
      url += `&query_place_id=${place.place_id}`;
    }
    window.open(url, '_blank');
  },

  addVisitDate() {
    const bName = this.getBrandName(this.currentDetailPlace.name);
    const date = prompt("請輸入日期 (YYYY/MM/DD):", new Date().toLocaleDateString('zh-TW'));
    if (date) {
      this.brandDatabase[bName].visits.unshift(date.trim());
      this.ensureInList(); 
      this.saveData();
      this.renderDetailData(bName);
    }
  },

  addMenuNote(category) {
    const bName = this.getBrandName(this.currentDetailPlace.name);
    const title = prompt(`新增「${category}」的餐點名稱：`);
    if (!title) return; 
    
    const ratingInput = prompt("請給這道餐點評分 (1~5顆星)：", "5");
    const rating = parseInt(ratingInput) || 5;

    const content = prompt("請輸入評價心得 (可留空)：");
    
    this.brandDatabase[bName].menu.push({
      title: title.trim(),
      content: content ? content.trim() : "",
      category: category,
      rating: rating
    });
    
    this.ensureInList(); 
    this.saveData();
    this.renderDetailData(bName);
  },

  addOverallReview() {
    const bName = this.getBrandName(this.currentDetailPlace.name);
    const title = prompt("請輸入總評價標題 (例如：整體環境、服務態度)：");
    if (!title) return;
    
    const content = prompt("請輸入評價心得細節 (可留空)：");
    
    if (!this.brandDatabase[bName].overall) {
      this.brandDatabase[bName].overall = [];
    }
    
    this.brandDatabase[bName].overall.unshift({
      title: title.trim(),
      content: content ? content.trim() : ""
    });
    
    this.ensureInList();
    this.saveData();
    this.renderDetailData(bName);
  },

  editData(type, index) {
    const bName = this.getBrandName(this.currentDetailPlace.name);
    const item = this.brandDatabase[bName][type][index];

    if (type === 'visits') {
      const newDate = prompt("修改日期 (YYYY/MM/DD):", item);
      if (newDate && newDate.trim() !== "") {
        this.brandDatabase[bName][type][index] = newDate.trim();
        this.saveData();
        this.renderDetailData(bName);
      }
    } 
    else if (type === 'menu') {
      const newTitle = prompt("修改餐點名稱：", item.title);
      if (!newTitle) return; 

      const ratingInput = prompt("修改評分 (1~5顆星)：", item.rating || 5);
      const newRating = parseInt(ratingInput) || item.rating || 5;

      const newCategory = item.category;
      const newContent = prompt("修改評價心得：", item.content || "");

      this.brandDatabase[bName][type][index] = {
        title: newTitle.trim(),
        content: newContent ? newContent.trim() : "",
        rating: newRating,
        category: newCategory
      };
      
      this.saveData();
      this.renderDetailData(bName);
    } 
    else if (type === 'overall') {
      const oldTitle = item.title || "總評價";
      const newTitle = prompt("修改總評價標題：", oldTitle);
      if (!newTitle) return;

      const newContent = prompt("修改評價心得細節：", item.content || "");
      
      this.brandDatabase[bName][type][index] = {
        title: newTitle.trim(),
        content: newContent ? newContent.trim() : ""
      };
      
      this.saveData();
      this.renderDetailData(bName);
    }
  },

  deleteData(type, index) {
    const bName = this.getBrandName(this.currentDetailPlace.name);
    if(confirm("確定要刪除這筆資料嗎？")) {
      this.brandDatabase[bName][type].splice(index, 1);
      this.saveData();
      this.renderDetailData(bName);
    }
  },

  showAddToListModal() {
    let html = `<h3 style="margin-top:0">加入清單</h3>`;
    Object.keys(this.userLists).forEach(listName => {
      const isAlreadyIn = this.userLists[listName].some(p => p.place_id === this.currentDetailPlace.place_id);
      const isChecked = isAlreadyIn ? 'checked' : '';
      const emoji = this.listEmojis[listName] || '🔖';
      
      html += `
        <label style="display:block; margin:15px 0; font-size:16px; cursor:pointer;">
          <input type="checkbox" ${isChecked} onchange="App.toggleRestaurantInList('${listName}', this.checked)" style="transform: scale(1.2); margin-right:10px;"> 
          ${emoji} ${listName}
        </label>`;
    });
    html += `<div class="modal-actions"><button class="btn-primary" onclick="App.closeModal()">完成</button></div>`;
    this.openModal(html);
  },

  toggleRestaurantInList(listName, isAdding) {
    if (isAdding) {
      if (!this.userLists[listName].some(p => p.place_id === this.currentDetailPlace.place_id)) {
        this.userLists[listName].push(this.currentDetailPlace);
      }
    } else {
      this.userLists[listName] = this.userLists[listName].filter(p => p.place_id !== this.currentDetailPlace.place_id);
      this.checkAndMoveToUncategorized(this.currentDetailPlace);
    }
    this.saveData();
    this.rebuildMarkers();
    this.updateVisibleRestaurants();
    
    if (document.getElementById('view-lists').classList.contains('active')) {
      this.renderLists();
    }
  },

  renameList(oldName) {
    if (oldName === '未分類') return alert("「未分類」為系統保護清單，無法修改名稱喔！");
    
    const newName = prompt("請輸入新的清單名稱：", oldName);
    if (!newName || newName.trim() === "" || newName === oldName) return;
    if (this.userLists[newName]) return alert("已經有同名的清單囉！請換一個名稱。");

    this.userLists[newName] = this.userLists[oldName];
    this.listEmojis[newName] = this.listEmojis[oldName];

    if (this.activeListFilters.has(oldName)) {
      this.activeListFilters.delete(oldName);
      this.activeListFilters.add(newName);
    }

    delete this.userLists[oldName];
    delete this.listEmojis[oldName];

    this.saveData();
    this.renderLists();
    this.rebuildMarkers(); 
  },

  changeListEmoji(listName) {
    if (listName === '未分類') return alert("「未分類」為系統保護清單，無法修改圖示喔！");

    const currentEmoji = this.listEmojis[listName] || '🔖';
    const newEmoji = prompt(`請輸入新的清單圖示 (請使用表情符號 Emoji)：`, currentEmoji);
    
    if (!newEmoji || newEmoji.trim() === "" || newEmoji === currentEmoji) return;

    this.listEmojis[listName] = newEmoji.trim();

    this.saveData();
    this.renderLists(); 
    this.rebuildMarkers(); 
  },

  renderLists() {
    const container = document.getElementById('my-lists-container');
    container.innerHTML = ''; 
    
    if (Object.keys(this.userLists).length === 0) {
      container.innerHTML = '<p style="padding:20px;text-align:center;color:gray;">還沒有任何清單，點擊下方按鈕建立吧！</p>';
      return;
    }
    
    Object.entries(this.userLists).forEach(([name, restaurants]) => {
      const section = document.createElement('div');
      section.className = 'section';
      section.style.margin = '15px';
      
      const h3 = document.createElement('h3');
      h3.style.display = 'flex';
      h3.style.justifyContent = 'space-between';
      h3.style.alignItems = 'center';
      h3.style.margin = '0 0 10px 0';
      
      const emoji = this.listEmojis[name] || '🔖';
      const titleSpan = document.createElement('span');
      titleSpan.innerHTML = `${emoji} ${name} (${restaurants.length})`;
      
      const actionDiv = document.createElement('div');
      actionDiv.style.display = 'flex';
      actionDiv.style.gap = '10px';
      actionDiv.style.alignItems = 'center';

      if (name !== '未分類') {
        const editEmojiBtn = document.createElement('button');
        editEmojiBtn.innerText = '修圖';
        editEmojiBtn.style.cssText = 'background:none; color:#007AFF; border:none; cursor:pointer; font-weight:bold; font-size:14px; padding:0;';
        editEmojiBtn.onclick = () => this.changeListEmoji(name); 
        actionDiv.appendChild(editEmojiBtn);

        const renameBtn = document.createElement('button');
        renameBtn.innerText = '編輯';
        renameBtn.style.cssText = 'background:none; color:#007AFF; border:none; cursor:pointer; font-weight:bold; font-size:14px; padding:0;';
        renameBtn.onclick = () => this.renameList(name);
        actionDiv.appendChild(renameBtn);
      }

      const deleteListBtn = document.createElement('button');
      deleteListBtn.innerText = '刪除';
      deleteListBtn.style.cssText = 'background:none; color:#FF4D4F; border:none; cursor:pointer; font-weight:bold; font-size:14px; padding:0;';
      deleteListBtn.onclick = () => this.deleteList(name);
      
      actionDiv.appendChild(deleteListBtn);
      h3.appendChild(titleSpan);
      h3.appendChild(actionDiv);
      section.appendChild(h3);

      const ul = document.createElement('ul');
      ul.style.paddingLeft = '10px';
      
      if (restaurants.length > 0) {
        restaurants.forEach(r => {
          const li = document.createElement('li');
          li.style.listStyle = 'none';
          li.style.marginBottom = '12px';
          
          const wrapper = document.createElement('div');
          wrapper.style.display = 'flex';
          wrapper.style.justifyContent = 'space-between';
          wrapper.style.alignItems = 'center';

          const nameSpan = document.createElement('span');
          nameSpan.innerHTML = `📍 ${r.name}`;
          nameSpan.style.cssText = 'color:var(--primary); font-weight:bold; font-size:16px; cursor:pointer; text-decoration:underline; flex:1;';
          nameSpan.onclick = () => {
            if (this.map && r.geometry && r.geometry.location) {
              this.map.setCenter(r.geometry.location);
              this.map.setZoom(17);
            }
            this.openDetail(r);
          };

          const actionGroup = document.createElement('div');
          actionGroup.style.display = 'flex';
          actionGroup.style.gap = '10px';

          const editListsBtn = document.createElement('button');
          editListsBtn.innerText = '分類';
          editListsBtn.style.cssText = 'color:#007AFF; background:none; border:none; font-size:13px; cursor:pointer; padding:5px;';
          editListsBtn.onclick = (e) => {
            e.stopPropagation(); 
            this.currentDetailPlace = r; 
            this.showAddToListModal();
          };

          const removeBtn = document.createElement('button');
          removeBtn.innerText = '移除';
          removeBtn.style.cssText = 'color:red; background:none; border:none; font-size:13px; cursor:pointer; padding:5px;';
          removeBtn.onclick = (e) => {
            e.stopPropagation(); 
            if(confirm(`確定要從「${name}」中移除 ${r.name} 嗎？`)) {
              this.userLists[name] = this.userLists[name].filter(p => p.place_id !== r.place_id);
              this.checkAndMoveToUncategorized(r);
              this.saveData();
              this.renderLists();
            }
          };

          actionGroup.appendChild(editListsBtn);
          actionGroup.appendChild(removeBtn);
          
          wrapper.appendChild(nameSpan);
          wrapper.appendChild(actionGroup);
          li.appendChild(wrapper);
          ul.appendChild(li);
        });
      } else {
        ul.innerHTML = '<li style="list-style:none; color:gray;">此清單尚無餐廳</li>';
      }
      
      section.appendChild(ul);
      container.appendChild(section);
    });
  },

  showCreateListModal() {
    const name = prompt("請輸入新清單名稱:");
    if (name && !this.userLists[name]) {
      this.userLists[name] = [];
      this.listEmojis[name] = '🔖';
      this.saveData();
      this.renderLists();
    }
  },

  deleteList(name) {
    if (confirm(`確定刪除「${name}」？此操作無法復原。`)) {
      const placesToCheck = [...this.userLists[name]]; 
      
      delete this.userLists[name];
      delete this.listEmojis[name];
      this.activeListFilters.delete(name);
      
      placesToCheck.forEach(place => {
        this.checkAndMoveToUncategorized(place);
      });

      this.saveData();
      this.renderLists();
    }
  },

  spinCompass() {
    const allRest = Object.values(this.userLists).flat();
    if (allRest.length === 0) return alert("清單內沒有餐廳可以抽！快去首頁搜尋並加入清單吧。");
    
    let uniqueMap = new Map();
    allRest.forEach(r => uniqueMap.set(r.place_id, r));
    this.compassCandidates = Array.from(uniqueMap.values());

    let html = `
      <h3 style="margin-top:0; color:var(--primary);">🧭 羅盤抽籤</h3>
      <p style="color:#555; font-size:14px; margin-bottom:15px;">請勾選你想加入抽籤的餐廳：</p>
      <div style="max-height: 40vh; overflow-y: auto; background:#f9f9f9; padding:10px; border-radius:8px; margin-bottom:15px; border:1px solid #eee;">
    `;
    
    this.compassCandidates.forEach((r, idx) => {
      html += `
        <label style="display:flex; align-items:center; margin-bottom:12px; cursor:pointer; font-size:15px; color:#333;">
          <input type="checkbox" class="compass-checkbox" value="${idx}" checked style="transform: scale(1.3); margin-right:12px;"> 
          ${r.name}
        </label>
      `;
    });

    html += `
      </div>
      <div class="modal-actions" style="justify-content: space-between;">
        <button onclick="App.closeModal()" style="background:#eee; color:#333; border:none; padding:10px 18px; border-radius:20px; font-weight:bold; cursor:pointer;">取消</button>
        <button class="btn-primary" onclick="App.executeCompass()">🎰 開始抽籤</button>
      </div>
    `;
    this.openModal(html);
  },

  executeCompass() {
    const checkboxes = document.querySelectorAll('.compass-checkbox:checked');
    if (checkboxes.length === 0) return alert("❌ 請至少勾選一間餐廳喔！");
    
    const selectedIndices = Array.from(checkboxes).map(cb => parseInt(cb.value));
    const pickIdx = selectedIndices[Math.floor(Math.random() * selectedIndices.length)];
    const pick = this.compassCandidates[pickIdx];
    
    alert(`🧭 羅盤結果：\n\n🎉 ${pick.name}\n📍 ${pick.vicinity || '無地址資訊'}\n\n就決定吃這家了！`);
    this.closeModal();
  },

  showBrandRenameModal() {
    const oldBrand = this.getBrandName(this.currentDetailPlace.name);
    const newBrand = prompt("修改這間餐廳的歸屬品牌：", oldBrand);
    
    if (newBrand && newBrand !== oldBrand) {
      this.brandMappings[this.currentDetailPlace.name] = newBrand;
      
      if (this.brandDatabase[oldBrand]) {
        if (!this.brandDatabase[newBrand]) {
          this.brandDatabase[newBrand] = this.brandDatabase[oldBrand];
        } else {
          this.brandDatabase[newBrand].visits.push(...this.brandDatabase[oldBrand].visits);
          this.brandDatabase[newBrand].menu.push(...this.brandDatabase[oldBrand].menu);
          if(this.brandDatabase[oldBrand].overall) {
            if(!this.brandDatabase[newBrand].overall) this.brandDatabase[newBrand].overall = [];
            this.brandDatabase[newBrand].overall.push(...this.brandDatabase[oldBrand].overall);
          }
        }
        delete this.brandDatabase[oldBrand];
      }
      this.saveData();
      this.openDetail(this.currentDetailPlace);
    }
  },

  navigate(viewId) {
    document.querySelectorAll('.view-container').forEach(el => el.classList.remove('active'));
    document.getElementById('view-' + viewId).classList.add('active');
    
    if(viewId === 'home' && this.map) {
       google.maps.event.trigger(this.map, 'resize');
       this.map.setCenter(this.mapCenter);
    }
    if (viewId === 'lists') this.renderLists();
  },
  
  openModal(htmlContent) {
    document.getElementById('modal-content').innerHTML = htmlContent;
    document.getElementById('modal-overlay').style.display = 'flex';
  },
  
  closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
  }
};

window.App = App;