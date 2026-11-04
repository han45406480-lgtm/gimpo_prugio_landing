(function () {
  'use strict';
  var API = 'https://bunyang-ai-studio.vercel.app/api/gimpo';
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  var el = function (id) { return document.getElementById(id); };
  var form = el('lead-form');
  var name = el('user-name');
  var phone = el('user-phone');
  var consent = el('privacy-consent');
  var overseas = el('overseas-consent');
  var submit = el('btn-submit');
  var status = el('submit-status');
  var settings = null;
  var busy = false;
  var selectedType = '84㎡ (34평)';
  var pending = null;

  function view(id) {
    ['view-user', 'view-admin', 'view-complete'].forEach(function (item) { el(item).style.display = item === id ? 'block' : 'none'; });
    el('tab-user').classList.toggle('active', id !== 'view-admin');
    el('tab-admin').classList.toggle('active', id === 'view-admin');
  }
  el('tab-user').addEventListener('click', function () { view('view-user'); });
  el('tab-admin').addEventListener('click', function () { view('view-admin'); });
  el('btn-back').addEventListener('click', function () { view('view-user'); });

  function selectRadio(value) {
    document.querySelectorAll('.radio-card').forEach(function (card) {
      var selected = card.getAttribute('data-value') === value;
      card.classList.toggle('selected', selected);
      if (selected) selectedType = value;
    });
  }
  document.querySelectorAll('.radio-card').forEach(function (card) {
    card.addEventListener('click', function () { if (!busy) selectRadio(card.getAttribute('data-value')); });
  });
  document.querySelectorAll('.price-card').forEach(function (card) {
    card.addEventListener('click', function () {
      if (!busy) selectRadio(card.getAttribute('data-type'));
      el('section-form').scrollIntoView({ behavior: 'smooth' });
    });
  });
  phone.addEventListener('input', function () {
    var digits = phone.value.replace(/[^0-9]/g, '').slice(0, 11);
    phone.value = digits.length <= 3 ? digits : digits.length <= 7 ? digits.slice(0, 3) + '-' + digits.slice(3) :
      digits.slice(0, 3) + '-' + digits.slice(3, -4) + '-' + digits.slice(-4);
  });

  async function request(path, options) {
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 12000);
    try {
      var response = await fetch(API + path, Object.assign({ cache: 'no-store', credentials: 'omit', signal: controller.signal }, options));
      return { response: response, data: await response.json() };
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw Error('접수 서버 응답을 확인하지 못했습니다. 입력을 유지한 채 다시 시도하거나 전화로 문의해 주세요.');
    } finally { clearTimeout(timeout); }
  }

  async function configure() {
    try {
      var result = await request('/config');
      var response = result.response;
      var data = result.data;
      if (!response.ok || data.enabled !== true) throw Error('온라인 접수를 준비 중입니다. 전화로 문의해 주세요.');
      if (!data.privacyNotice || !data.consentVersion || data.retentionMonths !== 1 || data.retentionTimeZone !== 'Asia/Seoul') throw Error('접수 안내를 확인하지 못했습니다. 전화로 문의해 주세요.');
      if (typeof crypto.randomUUID !== 'function') throw Error('이 브라우저에서는 온라인 신청을 지원하지 않습니다. 최신 브라우저 또는 전화로 문의해 주세요.');
      settings = data;
      el('privacy-notice').textContent = data.privacyNotice;
      el('retention-notice').textContent = '보유기간: 접수 후 1개월 보관 후 자동 삭제합니다. 한국시간 접수 시각부터 다음 달 같은 날짜·시각까지이며, 해당 날짜가 없으면 다음 달 말일 같은 시각까지 보관합니다.';
      status.textContent = '안내 내용을 확인하고 동의한 뒤 신청해 주세요.';
      submit.disabled = false;
    } catch (error) {
      status.textContent = error.name === 'AbortError' ? '접수 준비 상태를 확인하지 못했습니다. 새로고침하거나 전화로 문의해 주세요.' : error.message;
    }
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (busy || !settings) return;
    var cleanName = name.value.trim();
    var cleanPhone = phone.value.replace(/[- ]/g, '');
    var nameValid = cleanName.length > 0 && cleanName.length <= 80 && !/[\x00-\x1f\x7f]/.test(cleanName);
    var phoneValid = /^01[016789]\d{7,8}$/.test(cleanPhone);
    el('err-name').style.display = nameValid ? 'none' : 'block';
    el('err-phone').style.display = phoneValid ? 'none' : 'block';
    if (!nameValid || !phoneValid) return;
    if (!consent.checked || !overseas.checked) { status.textContent = '개인정보 수집·이용 및 국외 이전 안내를 확인하고 각각 동의해 주세요.'; return; }
    var snapshot = { name: cleanName, phone: cleanPhone, type: selectedType, consent: true, overseasConsent: true, consentVersion: settings.consentVersion };
    var signature = JSON.stringify(snapshot);
    if (!pending || pending.signature !== signature) pending = { signature: signature, id: crypto.randomUUID() };
    busy = true;
    submit.disabled = true;
    [name, phone, consent, overseas].forEach(function (input) { input.disabled = true; });
    status.textContent = '접수를 저장하고 확인 중입니다…';
    try {
      var result = await request('/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ requestId: pending.id }, snapshot)) });
      var response = result.response;
      var receipt = result.data;
      if (!response.ok) {
        if (response.status === 409 || response.status === 410) pending = null;
        throw Error(receipt.error || '저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 시도해 주세요.');
      }
      if (![200, 201].includes(response.status) || receipt.saved !== true || !UUID.test(receipt.id) || !Number.isFinite(Date.parse(receipt.createdAt))) throw Error('저장 확인 응답을 받지 못했습니다. 같은 내용으로 다시 시도해 주세요.');
      el('success-phone').textContent = cleanPhone;
      el('receipt-id').textContent = receipt.id;
      name.value = ''; phone.value = ''; consent.checked = false; overseas.checked = false; pending = null;
      status.textContent = '신청이 저장되었습니다. 동일한 신청을 짧은 시간 안에 다시 보내면 기존 접수번호로 안내합니다.';
      view('view-complete');
    } catch (error) {
      status.textContent = error.name === 'AbortError' ? '저장 확인 시간이 초과되었습니다. 입력은 유지됩니다. 같은 내용으로 다시 시도해 주세요.' : error.message;
    } finally {
      busy = false; submit.disabled = false;
      [name, phone, consent, overseas].forEach(function (input) { input.disabled = false; });
    }
  });
  configure();
})();
