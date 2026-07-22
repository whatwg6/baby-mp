export default defineAppConfig({
  pages: [
    'pages/auth/index',
    'pages/babies/create',
    'pages/babies/index',
    'pages/babies/edit',
    'pages/records/edit',
    'pages/records/detail',
    'pages/family/members',
    'pages/family/invite-create',
    'pages/family/invite',
    'pages/exports/index',
    'pages/exports/detail',
    'pages/legal/privacy',
    'pages/legal/terms',
    'pages/legal/data-rights',
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
