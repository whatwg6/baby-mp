export default defineAppConfig({
  pages: [
    'pages/home/index',
    'pages/timeline/index',
    'pages/growth/index',
    'pages/profile/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#fffaf5',
    navigationBarTitleText: '宝宝成长记',
    navigationBarTextStyle: 'black',
  },
  tabBar: {
    color: '#6f6a66',
    selectedColor: '#a95d42',
    backgroundColor: '#ffffff',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/home/index',
        text: '首页',
      },
      {
        pagePath: 'pages/timeline/index',
        text: '时间轴',
      },
      {
        pagePath: 'pages/growth/index',
        text: '成长',
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
      },
    ],
  },
})
