// ==========================================
// 🌟 Google Apps Script (試算表 API) 網址
// ==========================================
const GAS_URL = "https://script.google.com/macros/s/AKfycbyeOz9yNccHJoy-CTaAhgMWC6XhpzNgRX4IBm6HGXZsY0p5FMq9zJteSHbAGCAV-60eMA/exec";

const App = {
  map: null,
  placesService: null,
  markers: [],
  mapCenter: { lat: 25.0330, lng: 121.5654 }, 
  searchResults: [],
  visibleResults: [],
  lastSearchLocation: null, 
  lastKeyword: "", 
  
  userLocation: null,
  userMarker: null,
  
  userLists: { '未分類': [] },
  listEmojis: { '未分類': '🔖' },
  brandDatabase: {},
  brandMappings: {},
  activeListFilters: new Set(),
  expandedLists: new Set(), 
  
  currentDetailPlace: null,

  // 🌟 用來暫存編輯視窗的圖片狀態
  tempMenuImageUrl: null,
  tempOverallImages: [],

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
        this.listEmojis = data.listEmojis || {}; 
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

    if (!this.listEmojis['未分類']) {
      this.listEmojis['未分類'] = '🔖';
    }
    for (let listName in this.userLists) {
      if (!this.listEmojis[listName]) {
        this.listEmojis[listName] = '🔖'; 
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

  // 🌟 已移除自動壓縮功能，改為上傳原檔
  async uploadImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async (e) => {
        // 直接取得 Base64 原檔編碼
        const base64Data = e.target.result.split(',')[1];
        
        try {
          const res = await fetch(GAS_URL, {
            method: 'POST',
            redirect: 'follow',
            headers: {
              'Content-Type': 'text/plain;charset=utf-8'
            },
            body: JSON.stringify({
              action: 'uploadImage',
              data: base64Data,
              mimeType: file.type,
              filename: file.name
            })
          });
          const result = await res.json();
          
          if (result.error) {
            reject(new Error("後端錯誤: " + result.error));
          } else {
            resolve(result.url);
          }
        } catch(error) {
          reject(error);
        }
      };
      reader.onerror = reject;
    });
  },

  getStarString(rating) {
    if (rating === null || rating === undefined || rating === '' || isNaN(rating)) {
      return `<span style="color:#999; font-size:13px; margin-left:6px;">(無評分)</span>`;
    }
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

  isInAnyList(place) {
    const bName = this.getBrandName(place.name);
    for (const listName in this.userLists) {
      if (this.userLists[listName].some(p => this.getBrandName(p.name) === bName)) return true;
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

  toggleBottomSheet() {
    const sheet = document.getElementById('list-container');
    if (sheet) {
      sheet.classList.toggle('collapsed');
    }
  },

  searchInCurrentArea() {
    this.performSearch(this.map.getCenter(), '500', false);
  },

  advancedSearch() {
    const rawKeyword = document.getElementById('search-input').value.trim();
    if (!rawKeyword) {
      alert("⚠️ 進階搜尋需要請您先輸入「餐廳名稱」喔！");
      return;
    }
    this.performSearch(this.map.getCenter(), '50000', true);
  },

  performSearch(specificLocation = null, radius = '500', isAdvanced = false) {
    const rawKeyword = document.getElementById('search-input').value.trim();
    const searchKeyword = rawKeyword || (isAdvanced ? rawKeyword : '餐廳|美食|小吃|晚餐|飲食');
    const loc = specificLocation || this.mapCenter;
    
    this.lastSearchLocation = loc; 
    this.lastKeyword = rawKeyword.toLowerCase(); 
    
    this.placesService.nearbySearch({ location: loc, radius: radius, keyword: searchKeyword }, (results, status) => {
      let finalResults = [];
      
      if (status === google.maps.places.PlacesServiceStatus.OK && results) {
        if (isAdvanced && this.lastKeyword) {
          finalResults = results.filter(p => p.name.toLowerCase().includes(this.lastKeyword));
        } else {
          finalResults = [...results];
        }
      }

      if (this.lastKeyword) {
        const addedIds = new Set(finalResults.map(p => p.place_id));
        for (const listName in this.userLists) {
          this.userLists[listName].forEach(place => {
            if (place.name.toLowerCase().includes(this.lastKeyword) && !addedIds.has(place.place_id)) {
              finalResults.push(place);
              addedIds.add(place.place_id);
            }
          });
        }
      }

      this.searchResults = finalResults;
      document.getElementById('search-here-btn').style.display = 'none';
      this.rebuildMarkers();
      this.updateVisibleRestaurants();
      
      const sheet = document.getElementById('list-container');
      if (sheet) {
        sheet.classList.remove('collapsed');
      }
    });
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
               text: this.listEmojis[listName] || '🔖', 
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
      
      const bName = this.getBrandName(place.name);
      let activeEmoji = null;
      let activeListName = null;
      
      for (let listName of this.activeListFilters) {
        if (this.userLists[listName] && this.userLists[listName].some(p => this.getBrandName(p.name) === bName)) {
          activeEmoji = this.listEmojis[listName] || '🔖';
          activeListName = listName;
          break;
        }
      }

      if (activeEmoji) {
        const marker = new google.maps.Marker({
          map: this.map, 
          position: place.geometry.location, 
          title: `[${activeListName}] ${place.name}`,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 14, fillColor: '#FFFFFF', fillOpacity: 1, strokeWeight: 2, strokeColor: '#FF7A00' },
          label: { text: activeEmoji, fontSize: '16px' }, 
          zIndex: 1000 
        });
        marker.addListener('click', () => {
          this.map.setCenter(place.geometry.location);
          this.map.setZoom(17);
          this.openDetail(place);
        });
        this.markers.push(marker);
      } else {
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
      }
      addedPlaceIds.add(place.place_id);
    });
  },

  updateVisibleRestaurants() {
    const onlyOpen = document.getElementById('open-now-toggle').checked;
    const kw = this.lastKeyword;
    
    let filtered = this.searchResults.filter(p => {
      if (onlyOpen && (!p.opening_hours || !p.opening_hours.open_now)) return false;
      return true;
    });
    
    filtered.forEach(p => {
      p._saved = this.isInAnyList(p);
      p._distance = this.getDistance(this.lastSearchLocation, p.geometry.location);
      p._nameMatch = kw ? p.name.toLowerCase().includes(kw) : false;
    });

    filtered.sort((a, b) => {
      const aMatchSaved = a._nameMatch && a._saved;
      const bMatchSaved = b._nameMatch && b._saved;
      
      if (aMatchSaved && !bMatchSaved) return -1;
      if (!aMatchSaved && bMatchSaved) return 1;
      
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
      
      const uniqueBrands = new Set(this.userLists[listName].map(p => this.getBrandName(p.name)));
      
      html += `
        <label style="display:block; margin:15px 0; font-size:16px; cursor:pointer;">
          <input type="checkbox" ${isChecked} onchange="App.toggleFilter('${listName}', this.checked)" style="transform: scale(1.2); margin-right:10px;"> 
          ${emoji} ${listName} (${uniqueBrands.size})
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
    
    document.getElementById('detail-brand').innerHTML = `
      📂 品牌：${bName}
      <button onclick="App.showBrandRenameModal()" style="font-size:12px; padding:4px 8px; border-radius:12px; border:1px solid #FF7A00; background:white; color:#FF7A00; cursor:pointer;">✏️ 修改</button>
    `;
    
    document.getElementById('detail-address').innerText = `📍 ${place.vicinity || '無地址'}`;
    document.getElementById('detail-rating').innerText = `⭐️ 評分: ${place.rating || 'N/A'}`;
    
    this.renderDetailData(bName);
    this.updateDetailListBadges(); 
    this.navigate('detail');
  },

  updateDetailListBadges() {
    if (!this.currentDetailPlace) return;
    const bName = this.getBrandName(this.currentDetailPlace.name);
    const container = document.getElementById('detail-lists-badges');
    if (!container) return;

    let badgesHtml = '';
    for (const listName in this.userLists) {
      const isInList = this.userLists[listName].some(p => this.getBrandName(p.name) === bName);
      if (isInList) {
        const emoji = this.listEmojis[listName] || '🔖';
        badgesHtml += `<span style="background: #FFF0E5; color: #FF7A00; padding: 4px 10px; border-radius: 12px; font-size: 13px; font-weight: bold; display: inline-flex; align-items: center; gap: 4px;">${emoji} ${listName}</span>`;
      }
    }

    if (badgesHtml === '') {
       badgesHtml = `<span style="color: gray; font-size: 13px;">尚未加入任何清單</span>`;
    }
    container.innerHTML = badgesHtml;
  },

  showImageModal(imageUrl) {
    const html = `
      <div style="text-align:center;">
        <img src="${imageUrl}" style="max-width:100%; max-height:70vh; border-radius:8px; object-fit:contain;">
      </div>
      <div class="modal-actions">
        <button class="btn-primary" onclick="App.closeModal()" style="width:100%;">關閉</button>
      </div>
    `;
    this.openModal(html);
  },

  renderDetailData(bName) {
    const data = this.brandDatabase[bName];
    
    // 歷史紀錄
    const visitsHtml = data.visits.map((date, idx) => `
      <li style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid #eee; padding-bottom:6px;">
        <span style="font-size:15px;">${date}</span>
        <div style="display:flex; gap:10px;">
          <button style="color:#007AFF; border:none; background:none; cursor:pointer; font-size:14px;" onclick="App.editData('visits', ${idx})">編輯</button>
          <button style="color:#F44336; border:none; background:none; cursor:pointer; font-size:14px;" onclick="App.deleteData('visits', ${idx})">刪除</button>
        </div>
      </li>`).join('');
    document.getElementById('detail-visits').innerHTML = visitsHtml ? `<ul style="padding-left:10px; margin:0; list-style:none;">${visitsHtml}</ul>` : '<p style="color:gray; font-size:14px; margin:0;">尚無紀錄</p>';
    
    // 餐點評價
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
                ${m.imageUrl ? `<div style="margin-top: 8px;"><button onclick="App.showImageModal('${m.imageUrl}')" style="background:#f0f0f0; border:1px solid #ddd; padding:5px 10px; border-radius:15px; cursor:pointer; font-size:13px;">📷</button></div>` : ''}
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

    // 🌟 總評價 (支援多圖預覽顯示)
    const overallData = data.overall || [];
    const overallHtml = overallData.map((o, idx) => {
      const titleText = o.title || "總評價"; 
      
      // 處理相容舊版的單圖與新版的多圖
      let urls = o.imageUrls ? o.imageUrls : (o.imageUrl ? [o.imageUrl] : []);
      let imgsHtml = urls.map(url => `
        <img src="${url}" style="width:80px; height:80px; object-fit:cover; border-radius:6px; cursor:pointer; border:1px solid #FFE4D6;" onclick="App.showImageModal('${url}')">
      `).join('');

      return `
        <div style="background:#FFF9F5; padding:12px; margin-bottom:10px; border-radius:8px; border:1px solid #FFE4D6;">
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <strong style="color:#FF7A00; font-size:15px;">${titleText}</strong>
            <div style="display:flex; gap:10px;">
              <button style="color:#007AFF; border:none; background:none; cursor:pointer; padding:0; font-size:13px;" onclick="App.editData('overall', ${idx})">編輯</button>
              <button style="color:#F44336; border:none; background:none; cursor:pointer; padding:0; font-size:13px;" onclick="App.deleteData('overall', ${idx})">刪除</button>
            </div>
          </div>
          ${o.content ? `<p style="margin:0 0 8px 0; font-size:14px; color:#333; line-height:1.5;">${o.content}</p>` : ''}
          ${imgsHtml ? `<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">${imgsHtml}</div>` : ''}
        </div>
      `;
    }).join('');
    
    document.getElementById('detail-overall').innerHTML = overallHtml || '<p style="color:gray; font-size:14px; margin-top:10px;">尚無總評價</p>';
  },

  checkAndMoveToUncategorized(place) {
    if (!place) return;
    const bName = this.getBrandName(place.name);
    
    let isInAnyList = false;
    for (const listName in this.userLists) {
      if (this.userLists[listName].some(p => this.getBrandName(p.name) === bName)) {
        isInAnyList = true;
        break;
      }
    }
    if (isInAnyList) return; 

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
        if (!this.userLists['未分類'].some(p => this.getBrandName(p.name) === bName)) {
          this.userLists['未分類'].push(place);
        }
      }
    }
  },

  ensureInList() {
    if (!this.currentDetailPlace) return;
    const place = this.currentDetailPlace;
    const bName = this.getBrandName(place.name);
    
    let isInAnyList = false;
    for (const listName in this.userLists) {
      if (this.userLists[listName].some(p => this.getBrandName(p.name) === bName)) {
        isInAnyList = true;
        if (!this.userLists[listName].some(p => p.place_id === place.place_id)) {
          this.userLists[listName].push(place);
        }
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
    const bName = this.getBrandName(this.currentDetailPlace.name);
    const branches = new Map(); 
    
    branches.set(this.currentDetailPlace.place_id, this.currentDetailPlace);

    for (const listName in this.userLists) {
        this.userLists[listName].forEach(p => {
            if (this.getBrandName(p.name) === bName) {
                branches.set(p.place_id, p);
            }
        });
    }

    const branchList = Array.from(branches.values());

    if (branchList.length === 1) {
        this.executeGoogleMapsOpen(branchList[0]);
    } else {
        let html = `<h3 style="margin-top:0">請選擇要導航的分店：</h3>`;
        branchList.forEach(p => {
            html += `
            <button class="action-btn" style="width:100%; margin-bottom:10px; background:#F9FAFB; color:#333; border:1px solid #ddd; text-align:left; padding:10px 15px;" 
                    onclick="App.executeGoogleMapsOpenById('${p.place_id}')">
                📍 ${p.name}
            </button>`;
        });
        html += `<div class="modal-actions"><button onclick="App.closeModal()" style="background:#eee; color:#333; border:none; padding:10px 18px; border-radius:20px; font-weight:bold; cursor:pointer; width:100%;">取消</button></div>`;
        this.openModal(html);
    }
  },

  executeGoogleMapsOpenById(placeId) {
    let placeToOpen = null;
    if (this.currentDetailPlace && this.currentDetailPlace.place_id === placeId) placeToOpen = this.currentDetailPlace;
    if (!placeToOpen) {
       for(const listName in this.userLists){
          const p = this.userLists[listName].find(x => x.place_id === placeId);
          if(p){ placeToOpen = p; break; }
       }
    }
    if(placeToOpen) {
        this.executeGoogleMapsOpen(placeToOpen);
        this.closeModal();
    }
  },

  executeGoogleMapsOpen(place) {
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
    const html = `
      <h3 style="margin-top:0">新增餐點評價</h3>
      <div style="margin-bottom: 12px; text-align: left;">
        <label style="display:block; margin-bottom:5px; font-size:14px; font-weight:bold; color:#555;">餐點名稱</label>
        <input type="text" id="menu-form-title" placeholder="請輸入餐點名稱" style="width:100%; padding:10px; box-sizing:border-box; border:1px solid #ccc; border-radius:6px; font-size:15px;">
      </div>
      <div style="display:flex; gap:10px; margin-bottom: 12px; text-align: left;">
        <div style="flex:1;">
          <label style="display:block; margin-bottom:5px; font-size:14px; font-weight:bold; color:#555;">分類</label>
          <select id="menu-form-category" style="width:100%; padding:10px; box-sizing:border-box; border:1px solid #ccc; border-radius:6px; font-size:15px; background:white;">
            <option value="好吃" ${category === '好吃' ? 'selected' : ''}>😋 好吃</option>
            <option value="普通" ${category === '普通' ? 'selected' : ''}>😐 普通</option>
            <option value="難吃" ${category === '難吃' ? 'selected' : ''}>🤮 難吃</option>
          </select>
        </div>
        <div style="flex:1;">
          <label style="display:block; margin-bottom:5px; font-size:14px; font-weight:bold; color:#555;">評分 (可留空)</label>
          <input type="number" id="menu-form-rating" min="1" max="5" placeholder="1~5星" style="width:100%; padding:10px; box-sizing:border-box; border:1px solid #ccc; border-radius:6px; font-size:15px;">
        </div>
      </div>
      <div style="margin-bottom: 12px; text-align: left;">
        <label style="display:block; margin-bottom:5px; font-size:14px; font-weight:bold; color:#555;">評價心得</label>
        <textarea id="menu-form-content" rows="3" placeholder="請輸入心得 (可留空)" style="width:100%; padding:10px; box-sizing:border-box; border:1px solid #ccc; border-radius:6px; font-size:15px; resize:vertical; font-family:inherit;"></textarea>
      </div>
      <div style="margin-bottom: 15px; text-align: left;">
        <label style="display:block; margin-bottom:5px; font-size:14px; font-weight:bold; color:#555;">上傳照片 (無壓縮原檔)</label>
        <input type="file" id="menu-form-image" accept="image/*" style="width:100%; font-size:14px;">
      </div>
      <div class="modal-actions" style="display:flex; gap:10px;">
        <button onclick="App.closeModal()" style="flex:1; background:#eee; color:#333; border:none; padding:12px; border-radius:20px; font-weight:bold; cursor:pointer; font-size:15px;">取消</button>
        <button id="save-menu-btn" onclick="App.submitMenuNote()" style="flex:1; background:var(--primary); color:white; border:none; padding:12px; border-radius:20px; font-weight:bold; cursor:pointer; font-size:15px;">儲存</button>
      </div>
    `;
    this.openModal(html);
  },

  async submitMenuNote() {
    const title = document.getElementById('menu-form-title').value.trim();
    if (!title) return alert("請輸入餐點名稱！");

    const btn = document.getElementById('save-menu-btn');
    btn.disabled = true;
    btn.innerText = '上傳與儲存中...';

    const category = document.getElementById('menu-form-category').value;
    const ratingRaw = document.getElementById('menu-form-rating').value;
    const rating = ratingRaw === '' ? null : parseInt(ratingRaw);
    const content = document.getElementById('menu-form-content').value.trim();
    
    let imageUrl = null;
    const fileInput = document.getElementById('menu-form-image');
    if (fileInput.files.length > 0) {
      try {
        imageUrl = await this.uploadImageFile(fileInput.files[0]);
      } catch (e) {
        alert("照片上傳失敗！原因：" + e.message);
        btn.disabled = false;
        btn.innerText = '儲存';
        return;
      }
    }

    const bName = this.getBrandName(this.currentDetailPlace.name);
    
    this.brandDatabase[bName].menu.push({
      title: title,
      content: content,
      category: category,
      rating: rating,
      imageUrl: imageUrl
    });
    
    this.ensureInList(); 
    this.saveData();
    this.renderDetailData(bName);
    this.closeModal();
  },

  // 🌟 移除暫存的單一菜單圖片
  removeTempMenuImage() {
    this.tempMenuImageUrl = null;
    document.getElementById('menu-edit-img-container').style.display = 'none';
  },

  // 🌟 移除暫存的總評價多張圖片之一
  removeTempOverallImage(index) {
    this.tempOverallImages.splice(index, 1);
    this.renderTempOverallImages();
  },

  // 🌟 渲染總評價編輯時的預覽圖片列
  renderTempOverallImages() {
    const container = document.getElementById('overall-edit-imgs');
    if(!container) return;
    
    if (this.tempOverallImages.length === 0) {
      container.innerHTML = '<span style="font-size:13px; color:#999;">目前沒有照片</span>';
      return;
    }
    
    container.innerHTML = this.tempOverallImages.map((url, i) => `
      <div style="position:relative; display:inline-block;">
        <img src="${url}" style="width:60px; height:60px; object-fit:cover; border-radius:6px; border:1px solid #ccc;">
        <button onclick="App.removeTempOverallImage(${i})" style="position:absolute; top:-6px; right:-6px; background:#F44336; color:white; border:none; border-radius:50%; width:20px; height:20px; font-size:10px; font-weight:bold; cursor:pointer; padding:0; display:flex; justify-content:center; align-items:center;">✕</button>
      </div>
    `).join('');
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
      // 🌟 編輯餐點：支援刪除單一圖片
      this.tempMenuImageUrl = item.imageUrl || null;
      const ratingValue = (item.rating === null || item.rating === undefined) ? '' : item.rating;
      
      const html = `
        <h3 style="margin-top:0">編輯餐點評價</h3>
        <div style="margin-bottom: 12px; text-align: left;">
          <label style="display:block; margin-bottom:5px; font-size:14px; font-weight:bold; color:#555;">餐點名稱</label>
          <input type="text" id="menu-form-title" value="${item.title || ''}" style="width:100%; padding:10px; box-sizing:border-box; border:1px solid #ccc; border-radius:6px; font-size:15px;">
        </div>
        <div style="display:flex; gap:10px; margin-bottom: 12px; text-align: left;">
          <div style="flex:1;">
            <label style="display:block; margin-bottom:5px; font-size:14px; font-weight:bold; color:#555;">分類</label>
            <input type="hidden" id="menu-form-category" value="${item.category}">
            <div style="width:100%; padding:10px; box-sizing:border-box; border:1px solid #eee; border-radius:6px; font-size:15px; background:#f9f9f9; color:#666;">
              ${item.category === '好吃' ? '😋 好吃' : item.category === '普通' ? '😐 普通' : '🤮 難吃'}
            </div>
          </div>
          <div style="flex:1;">
            <label style="display:block; margin-bottom:5px; font-size:14px; font-weight:bold; color:#555;">評分 (可留空)</label>
            <input type="number" id="menu-form-rating" min="1" max="5" value="${ratingValue}" placeholder="1~5星" style="width:100%; padding:10px; box-sizing:border-box; border:1px solid #ccc; border-radius:6px; font-size:15px;">
          </div>
        </div>
        <div style="margin-bottom: 12px; text-align: left;">
          <label style="display:block; margin-bottom:5px; font-size:14px; font-weight:bold; color:#555;">評價心得</label>
          <textarea id="menu-form-content" rows="3" style="width:100%; padding:10px; box-sizing:border-box; border:1px solid #ccc; border-radius:6px; font-size:15px; resize:vertical; font-family:inherit;">${item.content || ''}</textarea>
        </div>
        <div style="margin-bottom: 15px; text-align: left;">
          <label style="display:block; margin-bottom:5px; font-size:14px; font-weight:bold; color:#555;">目前照片</label>
          <div id="menu-edit-img-container" style="${this.tempMenuImageUrl ? 'display:flex;' : 'display:none;'} gap:10px; align-items:center; margin-bottom:10px;">
             <button onclick="App.showImageModal(App.tempMenuImageUrl)" style="background:#f0f0f0; border:1px solid #ddd; padding:5px 10px; border-radius:15px; cursor:pointer; font-size:13px;">📷</button>
             <button onclick="App.removeTempMenuImage()" style="background:#FFEbee; color:#F44336; border:1px solid #FFCDD2; padding:5px 10px; border-radius:15px; cursor:pointer; font-size:13px;">刪除</button>
          </div>
          <label style="display:block; margin-bottom:5px; font-size:14px; font-weight:bold; color:#555;">上傳新照片 (會覆蓋目前照片)</label>
          <input type="file" id="menu-form-image" accept="image/*" style="width:100%; font-size:14px;">
        </div>
        <div class="modal-actions" style="display:flex; gap:10px;">
          <button onclick="App.closeModal()" style="flex:1; background:#eee; color:#333; border:none; padding:12px; border-radius:20px; font-weight:bold; cursor:pointer; font-size:15px;">取消</button>
          <button id="save-menu-edit-btn" onclick="App.submitMenuEdit(${index})" style="flex:1; background:var(--primary); color:white; border:none; padding:12px; border-radius:20px; font-weight:bold; cursor:pointer; font-size:15px;">儲存</button>
        </div>
      `;
      this.openModal(html);
    } 
    else if (type === 'overall') {
      // 🌟 編輯總評價：支援多圖刪除、新增
      this.tempOverallImages = item.imageUrls ? [...item.imageUrls] : (item.imageUrl ? [item.imageUrl] : []);
      
      const html = `
        <h3 style="margin-top:0">編輯總評價</h3>
        <div style="margin-bottom: 12px; text-align: left;">
          <label style="display:block; margin-bottom:5px; font-size:14px; font-weight:bold; color:#555;">評價標題</label>
          <input type="text" id="overall-form-title" value="${item.title || ''}" style="width:100%; padding:10px; box-sizing:border-box; border:1px solid #ccc; border-radius:6px; font-size:15px;">
        </div>
        <div style="margin-bottom: 12px; text-align: left;">
          <label style="display:block; margin-bottom:5px; font-size:14px; font-weight:bold; color:#555;">評價細節</label>
          <textarea id="overall-form-content" rows="4" style="width:100%; padding:10px; box-sizing:border-box; border:1px solid #ccc; border-radius:6px; font-size:15px; resize:vertical; font-family:inherit;">${item.content || ''}</textarea>
        </div>
        <div style="margin-bottom: 15px; text-align: left;">
          <label style="display:block; margin-bottom:5px; font-size:14px; font-weight:bold; color:#555;">目前照片</label>
          <div id="overall-edit-imgs" style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px; min-height: 20px;"></div>
          
          <label style="display:block; margin-bottom:5px; font-size:14px; font-weight:bold; color:#555;">上傳更多照片 (可多選)</label>
          <input type="file" id="overall-form-image" accept="image/*" multiple style="width:100%; font-size:14px;">
        </div>
        <div class="modal-actions" style="display:flex; gap:10px;">
          <button onclick="App.closeModal()" style="flex:1; background:#eee; color:#333; border:none; padding:12px; border-radius:20px; font-weight:bold; cursor:pointer; font-size:15px;">取消</button>
          <button id="save-overall-edit-btn" onclick="App.submitOverallEdit(${index})" style="flex:1; background:var(--primary); color:white; border:none; padding:12px; border-radius:20px; font-weight:bold; cursor:pointer; font-size:15px;">儲存</button>
        </div>
      `;
      this.openModal(html);
      
      // 等待 DOM 繪製後立刻渲染目前多圖
      setTimeout(() => this.renderTempOverallImages(), 50);
    }
  },

  async submitMenuEdit(index) {
    const title = document.getElementById('menu-form-title').value.trim();
    if (!title) return alert("請輸入餐點名稱！");
    
    const btn = document.getElementById('save-menu-edit-btn');
    btn.disabled = true;
    btn.innerText = '上傳與儲存中...';

    const category = document.getElementById('menu-form-category').value;
    const ratingRaw = document.getElementById('menu-form-rating').value;
    const rating = ratingRaw === '' ? null : parseInt(ratingRaw);
    const content = document.getElementById('menu-form-content').value.trim();

    const bName = this.getBrandName(this.currentDetailPlace.name);
    
    // 如果有在編輯視窗中按下「刪除」，this.tempMenuImageUrl 會變成 null
    let imageUrl = this.tempMenuImageUrl; 
    
    const fileInput = document.getElementById('menu-form-image');
    // 如果有上傳新檔案，直接覆蓋舊的/空的
    if (fileInput.files.length > 0) {
      try {
        imageUrl = await this.uploadImageFile(fileInput.files[0]);
      } catch (e) {
        alert("照片上傳失敗！原因：" + e.message);
        btn.disabled = false;
        btn.innerText = '儲存';
        return;
      }
    }

    this.brandDatabase[bName].menu[index] = {
      title: title,
      content: content,
      rating: rating,
      category: category,
      imageUrl: imageUrl
    };
    
    this.saveData();
    this.renderDetailData(bName);
    this.closeModal();
  },

  // 🌟 總評價：新增時支援多檔案上傳
  addOverallReview() {
    const html = `
      <h3 style="margin-top:0">新增總評價</h3>
      <div style="margin-bottom: 12px; text-align: left;">
        <label style="display:block; margin-bottom:5px; font-size:14px; font-weight:bold; color:#555;">評價標題</label>
        <input type="text" id="overall-form-title" placeholder="例如：整體環境、服務態度" style="width:100%; padding:10px; box-sizing:border-box; border:1px solid #ccc; border-radius:6px; font-size:15px;">
      </div>
      <div style="margin-bottom: 12px; text-align: left;">
        <label style="display:block; margin-bottom:5px; font-size:14px; font-weight:bold; color:#555;">評價細節</label>
        <textarea id="overall-form-content" rows="4" placeholder="請輸入細節 (可留空)" style="width:100%; padding:10px; box-sizing:border-box; border:1px solid #ccc; border-radius:6px; font-size:15px; resize:vertical; font-family:inherit;"></textarea>
      </div>
      <div style="margin-bottom: 15px; text-align: left;">
        <label style="display:block; margin-bottom:5px; font-size:14px; font-weight:bold; color:#555;">上傳照片 (支援多張)</label>
        <input type="file" id="overall-form-image" accept="image/*" multiple style="width:100%; font-size:14px;">
      </div>
      <div class="modal-actions" style="display:flex; gap:10px;">
        <button onclick="App.closeModal()" style="flex:1; background:#eee; color:#333; border:none; padding:12px; border-radius:20px; font-weight:bold; cursor:pointer; font-size:15px;">取消</button>
        <button id="save-overall-btn" onclick="App.submitOverallNote()" style="flex:1; background:var(--primary); color:white; border:none; padding:12px; border-radius:20px; font-weight:bold; cursor:pointer; font-size:15px;">儲存</button>
      </div>
    `;
    this.openModal(html);
  },

  async submitOverallNote() {
    const title = document.getElementById('overall-form-title').value.trim();
    if (!title) return alert("請輸入標題！");

    const btn = document.getElementById('save-overall-btn');
    btn.disabled = true;
    btn.innerText = '上傳多圖與儲存中...';

    const content = document.getElementById('overall-form-content').value.trim();
    
    let imageUrls = [];
    const fileInput = document.getElementById('overall-form-image');
    
    // 多張圖片逐一上傳
    if (fileInput.files.length > 0) {
      try {
        for (let i = 0; i < fileInput.files.length; i++) {
            let url = await this.uploadImageFile(fileInput.files[i]);
            imageUrls.push(url);
        }
      } catch (e) {
        alert("照片上傳失敗！原因：" + e.message);
        btn.disabled = false;
        btn.innerText = '儲存';
        return;
      }
    }

    const bName = this.getBrandName(this.currentDetailPlace.name);
    
    if (!this.brandDatabase[bName].overall) {
      this.brandDatabase[bName].overall = [];
    }
    
    this.brandDatabase[bName].overall.unshift({
      title: title,
      content: content,
      imageUrls: imageUrls
    });
    
    this.ensureInList();
    this.saveData();
    this.renderDetailData(bName);
    this.closeModal();
  },

  // 🌟 編輯總評價送出：合併原本保留的圖 ＋ 新上傳的圖
  async submitOverallEdit(index) {
    const title = document.getElementById('overall-form-title').value.trim();
    if (!title) return alert("請輸入標題！");

    const btn = document.getElementById('save-overall-edit-btn');
    btn.disabled = true;
    btn.innerText = '上傳與儲存中...';

    const content = document.getElementById('overall-form-content').value.trim();
    const bName = this.getBrandName(this.currentDetailPlace.name);
    
    // 基礎名單：編輯視窗裡刪除剩下的圖片
    let imageUrls = [...this.tempOverallImages]; 

    const fileInput = document.getElementById('overall-form-image');
    if (fileInput.files.length > 0) {
      try {
        for(let i = 0; i < fileInput.files.length; i++) {
           let url = await this.uploadImageFile(fileInput.files[i]);
           imageUrls.push(url);
        }
      } catch (e) {
        alert("照片上傳失敗！原因：" + e.message);
        btn.disabled = false;
        btn.innerText = '儲存';
        return;
      }
    }
    
    this.brandDatabase[bName].overall[index] = {
      title: title,
      content: content,
      imageUrls: imageUrls
    };
    
    this.saveData();
    this.renderDetailData(bName);
    this.closeModal();
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
    const bName = this.getBrandName(this.currentDetailPlace.name);
    
    const listContainer = document.getElementById('modal-list-container');
    const currentScroll = listContainer ? listContainer.scrollTop : 0;
    
    let html = `<h3 style="margin-top:0">加入清單</h3>`;
    html += `<div id="modal-list-container" style="max-height: 50vh; overflow-y: auto; margin-bottom: 15px; padding-right: 5px;">`;
    
    Object.keys(this.userLists).forEach(listName => {
      const isAlreadyIn = this.userLists[listName].some(p => this.getBrandName(p.name) === bName);
      const isChecked = isAlreadyIn ? 'checked' : '';
      const emoji = this.listEmojis[listName] || '🔖';
      
      html += `
        <label style="display:block; margin:15px 0; font-size:16px; cursor:pointer;">
          <input type="checkbox" ${isChecked} onchange="App.toggleRestaurantInList('${listName}', this.checked)" style="transform: scale(1.2); margin-right:10px;"> 
          ${emoji} ${listName}
        </label>`;
    });
    
    html += `</div>`;
    html += `
      <div class="modal-actions" style="display:flex; gap:10px;">
        <button onclick="App.createNewListFromModal()" style="flex:1; background:#4CAF50; color:white; border:none; padding:12px; border-radius:20px; font-weight:bold; cursor:pointer; font-size:15px;">+ 新增清單</button>
        <button class="btn-primary" onclick="App.closeModal()" style="flex:1;">完成</button>
      </div>
    `;
    this.openModal(html);
    
    const newListContainer = document.getElementById('modal-list-container');
    if (newListContainer) {
        newListContainer.scrollTop = currentScroll;
    }
  },
  
  createNewListFromModal() {
    const name = prompt("請輸入新清單名稱:");
    if (name && !this.userLists[name]) {
      this.userLists[name] = [];
      this.listEmojis[name] = '🔖';
      this.expandedLists.add(name); 
      this.saveData();
      this.showAddToListModal();
    } else if (this.userLists[name]) {
      alert("清單名稱已存在！請換一個名稱。");
    }
  },

  toggleRestaurantInList(listName, isAdding) {
    const bName = this.getBrandName(this.currentDetailPlace.name);
    
    if (isAdding) {
      if (listName !== '未分類') {
        if (this.userLists['未分類']) {
          this.userLists['未分類'] = this.userLists['未分類'].filter(p => this.getBrandName(p.name) !== bName);
        }
      } else {
        for (const ln in this.userLists) {
          if (ln !== '未分類') {
            this.userLists[ln] = this.userLists[ln].filter(p => this.getBrandName(p.name) !== bName);
          }
        }
      }

      if (!this.userLists[listName].some(p => p.place_id === this.currentDetailPlace.place_id)) {
        this.userLists[listName].push(this.currentDetailPlace);
      }
      for (const ln in this.userLists) {
          this.userLists[ln].forEach(p => {
              if (this.getBrandName(p.name) === bName) {
                  if (!this.userLists[listName].some(existing => existing.place_id === p.place_id)) {
                      this.userLists[listName].push(p);
                  }
              }
          });
      }
    } else {
      this.userLists[listName] = this.userLists[listName].filter(p => this.getBrandName(p.name) !== bName);
      this.checkAndMoveToUncategorized(this.currentDetailPlace);
    }
    
    this.saveData();
    this.rebuildMarkers();
    this.updateVisibleRestaurants();
    this.updateDetailListBadges(); 
    
    if (document.getElementById('view-lists').classList.contains('active')) {
      this.renderLists();
    }

    this.showAddToListModal();
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
    
    if (this.expandedLists.has(oldName)) {
        this.expandedLists.delete(oldName);
        this.expandedLists.add(newName);
    }

    delete this.userLists[oldName];
    delete this.listEmojis[oldName];

    this.saveData();
    this.renderLists();
    this.rebuildMarkers(); 
    this.updateDetailListBadges(); 
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
    this.updateDetailListBadges(); 
  },

  renderLists() {
    const container = document.getElementById('my-lists-container');
    container.innerHTML = ''; 
    
    if (Object.keys(this.userLists).length === 0) {
      container.innerHTML = '<p style="padding:20px;text-align:center;color:gray;">還沒有任何清單，點擊下方按鈕建立吧！</p>';
      return;
    }
    
    const searchInput = document.getElementById('list-search-input');
    const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';
    
    Object.entries(this.userLists).forEach(([name, restaurants]) => {
      const uniqueRestaurants = [];
      const seenBrands = new Set();
      restaurants.forEach(r => {
        const bName = this.getBrandName(r.name);
        if (!seenBrands.has(bName)) {
          seenBrands.add(bName);
          uniqueRestaurants.push(r);
        }
      });
      
      let filteredRestaurants = uniqueRestaurants;
      let isListMatch = false; 
      
      if (keyword !== '') {
          if (name.toLowerCase().includes(keyword)) {
              isListMatch = true;
          } else {
              filteredRestaurants = uniqueRestaurants.filter(r => this.getBrandName(r.name).toLowerCase().includes(keyword));
          }
      }
      
      if (keyword !== '' && !isListMatch && filteredRestaurants.length === 0) {
          return;
      }
      
      const section = document.createElement('div');
      section.className = 'section';
      section.style.margin = '15px';
      
      let isExpanded = this.expandedLists.has(name) || keyword !== '';
      
      const h3 = document.createElement('h3');
      h3.style.display = 'flex';
      h3.style.justifyContent = 'space-between';
      h3.style.alignItems = 'center';
      h3.style.margin = '0 0 10px 0';
      h3.style.cursor = 'pointer'; 
      
      const emoji = this.listEmojis[name] || '🔖';
      const titleSpan = document.createElement('span');
      titleSpan.innerHTML = `<span style="display:inline-block; width:15px; font-size:12px; color:#888;">${isExpanded ? '▼' : '▶'}</span> ${emoji} ${name} (${filteredRestaurants.length})`; 
      
      const actionDiv = document.createElement('div');
      actionDiv.style.display = 'flex';
      actionDiv.style.gap = '10px';
      actionDiv.style.alignItems = 'center';

      if (name !== '未分類') {
        const editEmojiBtn = document.createElement('button');
        editEmojiBtn.innerText = '修圖';
        editEmojiBtn.style.cssText = 'background:none; color:#007AFF; border:none; cursor:pointer; font-weight:bold; font-size:14px; padding:0;';
        editEmojiBtn.onclick = (e) => { e.stopPropagation(); this.changeListEmoji(name); }; 
        actionDiv.appendChild(editEmojiBtn);

        const renameBtn = document.createElement('button');
        renameBtn.innerText = '編輯';
        renameBtn.style.cssText = 'background:none; color:#007AFF; border:none; cursor:pointer; font-weight:bold; font-size:14px; padding:0;';
        renameBtn.onclick = (e) => { e.stopPropagation(); this.renameList(name); };
        actionDiv.appendChild(renameBtn);
      }

      const deleteListBtn = document.createElement('button');
      deleteListBtn.innerText = '刪除';
      deleteListBtn.style.cssText = 'background:none; color:#FF4D4F; border:none; cursor:pointer; font-weight:bold; font-size:14px; padding:0;';
      deleteListBtn.onclick = (e) => { e.stopPropagation(); this.deleteList(name); };
      
      actionDiv.appendChild(deleteListBtn);
      h3.appendChild(titleSpan);
      h3.appendChild(actionDiv);
      section.appendChild(h3);

      const ul = document.createElement('ul');
      ul.style.paddingLeft = '10px';
      ul.style.display = isExpanded ? 'block' : 'none'; 
      
      h3.onclick = (e) => {
          if(e.target.tagName.toLowerCase() === 'button') return;
          
          isExpanded = !isExpanded;
          if (isExpanded) {
              this.expandedLists.add(name);
          } else {
              this.expandedLists.delete(name);
          }
          
          ul.style.display = isExpanded ? 'block' : 'none';
          titleSpan.innerHTML = `<span style="display:inline-block; width:15px; font-size:12px; color:#888;">${isExpanded ? '▼' : '▶'}</span> ${emoji} ${name} (${filteredRestaurants.length})`;
      };
      
      if (filteredRestaurants.length > 0) {
        filteredRestaurants.forEach(r => {
          const bName = this.getBrandName(r.name); 
          const li = document.createElement('li');
          li.style.listStyle = 'none';
          li.style.marginBottom = '12px';
          
          const wrapper = document.createElement('div');
          wrapper.style.display = 'flex';
          wrapper.style.justifyContent = 'space-between';
          wrapper.style.alignItems = 'center';

          const nameSpan = document.createElement('span');
          let displayName = bName;
          if (keyword !== '' && !isListMatch) {
              const regex = new RegExp(`(${keyword})`, "gi");
              displayName = bName.replace(regex, `<span style="background-color:#FFD54F;">$1</span>`);
          }
          
          nameSpan.innerHTML = `📍 ${displayName}`; 
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
            if(confirm(`確定要從「${name}」中移除品牌「${bName}」嗎？`)) {
              this.userLists[name] = this.userLists[name].filter(p => this.getBrandName(p.name) !== bName);
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
        ul.innerHTML = '<li style="list-style:none; color:gray;">此清單內沒有符合搜尋的餐廳</li>';
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
      this.expandedLists.add(name); 
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
      this.expandedLists.delete(name); 
      
      placesToCheck.forEach(place => {
        this.checkAndMoveToUncategorized(place);
      });

      this.saveData();
      this.renderLists();
    }
  },

  showBrandRenameModal() {
    const oldBrand = this.getBrandName(this.currentDetailPlace.name);
    const newBrand = prompt("修改這間餐廳的歸屬品牌：", oldBrand);
    
    if (newBrand && newBrand !== oldBrand) {
      for (let placeName in this.brandMappings) {
        if (this.brandMappings[placeName] === oldBrand) {
          this.brandMappings[placeName] = newBrand;
        }
      }
      
      this.brandMappings[this.currentDetailPlace.name] = newBrand;
      this.brandMappings[oldBrand] = newBrand; 
      
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