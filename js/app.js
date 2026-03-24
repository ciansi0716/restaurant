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
  
  userLocation: null,
  userMarker: null,
  
  userLists: { '未分類': [] },
  listEmojis: { '未分類': '🔖' },
  brandDatabase: {},
  brandMappings: {},
  activeListFilters: new Set(),
  
  currentDetailPlace: null,
  compassCandidates: [], 

  // ==========================================
  // 1. 初始化系統
  // ==========================================
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

  // ==========================================
  // 2. 資料存取 
  // ==========================================
  async loadData() {
    try {
      const response = await fetch(GAS_URL);
      const dataStr = await response.text();
      
      if (dataStr && dataStr.includes('brandDatabase')) {
        const data = JSON.parse(dataStr);
        this.userLists = data.userLists || { '未分類': [] };
        this.listEmojis = data.listEmojis || { '未分類': '🔖' };
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
        this.brandDatabase = data.brandDatabase || {};
        this.brandMappings = data.brandMappings || {};
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

  // ==========================================
  // 3. 視覺化星星產生器 (專門給使用者的餐點評分使用)
  // ==========================================
  getStarString(rating) {
    if (!rating) return '';
    const rounded = Math.max(1, Math.min(5, Math.round(rating))); // 確保在 1~5 之間
    const full = '★'.repeat(rounded);
    const empty = '☆'.repeat(5 - rounded);
    return `<span style="color:#FFB800; font-size:14px; letter-spacing:1px; margin-left:6px;">${full}${empty}</span>`;
  },

  // ==========================================
  // 4. 地圖與搜尋邏輯
  // ==========================================
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
    
    this.placesService.nearbySearch({ location: loc, radius: '5000', keyword: keyword }, (results, status) => {
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
    
    this.searchResults.forEach(place => {
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

    this.activeListFilters.forEach(listName => {
      if(this.userLists[listName]) {
        this.userLists[listName].forEach(place => {
           const marker = new google.maps.Marker({ 
             map: this.map, 
             position: place.geometry.location, 
             title: `[${listName}] ${place.name}`,
             icon: 'http://maps.google.com/mapfiles/ms/icons/green-dot.png',
             zIndex: 100
           });
           marker.addListener('click', () => {
             this.map.setCenter(place.geometry.location);
             this.map.setZoom(17);
             this.openDetail(place);
           });
           this.markers.push(marker);
        });
      }
    });
  },

  updateVisibleRestaurants() {
    const onlyOpen = document.getElementById('open-now-toggle').checked;
    this.visibleResults = this.searchResults.filter(p => {
      if (onlyOpen && (!p.opening_hours || !p.opening_hours.open_now)) return false;
      return true;
    });
    
    document.getElementById('result-count').innerText = `顯示 ${this.visibleResults.length} 間餐廳`;
    const listContainer = document.getElementById('search-results-list');
    listContainer.innerHTML = '';
    
    this.visibleResults.forEach(place => {
      const div = document.createElement('div');
      div.className = 'restaurant-card';
      // 🌟 Google 地圖評分維持原樣 (數字)
      div.innerHTML = `<div><strong>${place.name}</strong><br><small>${place.vicinity || ''}</small></div><div>⭐️ ${place.rating || 'N/A'}</div>`;
      
      div.onclick = () => { 
        this.map.setCenter(place.geometry.location); 
        this.map.setZoom(17); 
        this.openDetail(place); 
      };
      
      listContainer.appendChild(div);
    });
  },

  showFilterLayerModal() {
    let html = `<h3 style="margin-top:0">在地圖顯示清單</h3>`;
    Object.keys(this.userLists).forEach(listName => {
      const isChecked = this.activeListFilters.has(listName) ? 'checked' : '';
      html += `
        <label style="display:block; margin:15px 0; font-size:16px; cursor:pointer;">
          <input type="checkbox" ${isChecked} onchange="App.toggleFilter('${listName}', this.checked)" style="transform: scale(1.2); margin-right:10px;"> 
          ${this.listEmojis[listName]} ${listName} (${this.userLists[listName].length})
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

  // ==========================================
  // 5. 餐廳詳細頁邏輯
  // ==========================================
  getBrandName(fullName) {
    if (this.brandMappings[fullName]) return this.brandMappings[fullName];
    return fullName.split(/[(（-]/)[0].trim();
  },

  openDetail(place) {
    this.currentDetailPlace = place;
    const bName = this.getBrandName(place.name);
    
    if (!this.brandDatabase[bName]) {
      this.brandDatabase[bName] = { visits: [], menu: [], overall: [], notes: [] };
      this.saveData();
    } else {
      if (!this.brandDatabase[bName].overall) this.brandDatabase[bName].overall = [];
    }
    
    document.getElementById('detail-title').innerText = place.name;
    document.getElementById('detail-brand').innerText = `📂 品牌：${bName}`;
    document.getElementById('detail-address').innerText = `📍 ${place.vicinity || '無地址'}`;
    
    // 🌟 Google 地圖評分維持原樣 (數字)
    document.getElementById('detail-rating').innerText = `⭐️ 評分: ${place.rating || 'N/A'}`;
    
    this.renderDetailData(bName);
    this.navigate('detail');
  },

  renderDetailData(bName) {
    const data = this.brandDatabase[bName];
    
    const visitsHtml = data.visits.map((date, idx) => `
      <li style="display:flex; justify-content:space-between; margin-bottom:8px;">
        ${date} <button style="color:red; border:none; background:none; cursor:pointer" onclick="App.deleteData('visits', ${idx})">刪除</button>
      </li>`).join('');
    document.getElementById('detail-visits').innerHTML = visitsHtml ? `<ul style="padding-left:20px; margin:0;">${visitsHtml}</ul>` : '<p style="color:gray; font-size:14px; margin:0;">尚無紀錄</p>';
    
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
                  <button style="color:red; border:none; background:none; cursor:pointer; padding:0;" onclick="App.deleteData('menu', ${realIdx})">刪除</button>
                </div>
                ${m.content ? `<p style="margin:0; font-size:13px; color:#666;">${m.content}</p>` : ''}
              </div>
            `;
          }).join('') : `<p style="color:gray; font-size:13px; margin:0;">尚無紀錄</p>`}
        </div>
      `;
    };

    let menuHtml = renderMenuCategory(good, '好吃', '😋', '#4CAF50');
    menuHtml += renderMenuCategory(normal, '普通', '😐', '#FF9800');
    menuHtml += renderMenuCategory(bad, '難吃', '🤮', '#F44336');

    document.getElementById('detail-menu').innerHTML = menuHtml;

    const overallData = data.overall || [];
    const overallHtml = overallData.map((o, idx) => `
      <div style="background:#FFF9F5; padding:12px; margin-bottom:10px; border-radius:8px; border:1px solid #FFE4D6;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
          <small style="color:#FF7A00; font-weight:bold;">${o.date}</small>
          <button style="color:red; border:none; background:none; cursor:pointer; padding:0;" onclick="App.deleteData('overall', ${idx})">刪除</button>
        </div>
        <p style="margin:0; font-size:14px; color:#333; line-height:1.5;">${o.content}</p>
      </div>
    `).join('');
    
    document.getElementById('detail-overall').innerHTML = overallHtml || '<p style="color:gray; font-size:14px; margin-top:10px;">尚無總評價</p>';
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

  addVisitDate() {
    const bName = this.getBrandName(this.currentDetailPlace.name);
    const date = prompt("請輸入日期 (YYYY/MM/DD):", new Date().toLocaleDateString('zh-TW'));
    if (date) {
      this.brandDatabase[bName].visits.unshift(date);
      this.ensureInList(); 
      this.saveData();
      this.renderDetailData(bName);
    }
  },

  // 🌟 餐點評價新增功能 (加入星星評分輸入)
  addMenuNote(category) {
    const bName = this.getBrandName(this.currentDetailPlace.name);
    
    const title = prompt(`新增「${category}」的餐點名稱：`);
    if (!title) return; // 按取消就退出
    
    // 🌟 詢問這道菜你要給幾顆星
    const ratingInput = prompt("請給這道餐點評分 (1~5顆星)：", "5");
    const rating = parseInt(ratingInput) || 5;

    const content = prompt("請輸入評價心得 (可留空)：");
    
    this.brandDatabase[bName].menu.push({
      title: title,
      content: content || "",
      category: category,
      rating: rating // 將星星存入資料庫
    });
    
    this.ensureInList(); 
    this.saveData();
    this.renderDetailData(bName);
  },

  addOverallReview() {
    const bName = this.getBrandName(this.currentDetailPlace.name);
    const content = prompt("請輸入對這間餐廳的總評價或筆記：");
    if (!content) return;
    
    if (!this.brandDatabase[bName].overall) {
      this.brandDatabase[bName].overall = [];
    }
    
    this.brandDatabase[bName].overall.unshift({
      date: new Date().toLocaleDateString('zh-TW'),
      content: content
    });
    
    this.ensureInList();
    this.saveData();
    this.renderDetailData(bName);
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
      
      html += `
        <label style="display:block; margin:15px 0; font-size:16px; cursor:pointer;">
          <input type="checkbox" ${isChecked} onchange="App.toggleRestaurantInList('${listName}', this.checked)" style="transform: scale(1.2); margin-right:10px;"> 
          ${this.listEmojis[listName]} ${listName}
        </label>`;
    });
    html += `<div class="modal-actions"><button class="btn-primary" onclick="App.closeModal()">完成</button></div>`;
    this.openModal(html);
  },

  toggleRestaurantInList(listName, isAdding) {
    if (isAdding) {
      this.userLists[listName].push(this.currentDetailPlace);
    } else {
      this.userLists[listName] = this.userLists[listName].filter(p => p.place_id !== this.currentDetailPlace.place_id);
    }
    this.saveData();
  },

  // ==========================================
  // 6. 我的清單
  // ==========================================
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
      h3.innerHTML = `${this.listEmojis[name]} ${name} (${restaurants.length}) 
        <button onclick="App.deleteList('${name}')" style="background:none; color:#FF4D4F; border:none; cursor:pointer; font-weight:bold;">刪除</button>`;
      section.appendChild(h3);

      const ul = document.createElement('ul');
      ul.style.paddingLeft = '10px';
      
      if (restaurants.length > 0) {
        restaurants.forEach(r => {
          const li = document.createElement('li');
          li.style.listStyle = 'none';
          li.style.marginBottom = '12px';
          li.innerHTML = `<span style="color:var(--primary); font-weight:bold; font-size:16px; cursor:pointer; text-decoration:underline;">📍 ${r.name}</span>`;
          
          li.onclick = () => {
            if (this.map && r.geometry && r.geometry.location) {
              this.map.setCenter(r.geometry.location);
              this.map.setZoom(17);
            }
            this.openDetail(r);
          };
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
      delete this.userLists[name];
      delete this.listEmojis[name];
      this.activeListFilters.delete(name);
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

  // ==========================================
  // 7. 品牌管理與底層機制
  // ==========================================
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