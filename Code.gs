function doGet() {
  var template = HtmlService.createTemplateFromFile('Index');
  template.appName = APP_CONFIG.APP_NAME;
  template.appVersion = APP_CONFIG.VERSION;
  return template.evaluate()
    .setTitle(APP_CONFIG.APP_NAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function include_(fileName) {
  return HtmlService.createHtmlOutputFromFile(fileName).getContent();
}
