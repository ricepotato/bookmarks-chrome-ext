// 서비스 워커: 확장 아이콘 클릭 시 관리 페이지를 새 탭으로 연다.
// action.default_popup을 지정하지 않았기 때문에 onClicked가 정상적으로 동작한다.
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
