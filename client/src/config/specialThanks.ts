import songhuangImage from '../assets/songhuang.jpg';
import ymgalImage from '../assets/ymgal.png';
import bangumiImage from '../assets/bangumi.png';

export interface SpecialThanksItem {
  name: string;
  note?: string;
  image?: string;
  href: string;
  analyticsEvent: string;
}

export const SPECIAL_THANKS: SpecialThanksItem[] = [
  {
    name: '怂皇的一天',
    note: '开源了csgofriberg的代码',
    image: songhuangImage,
    href: 'https://github.com/shnlfriberg/csgofriberg',
    analyticsEvent: 'home-special-thanks-songhuang',
  },
  {
    name: 'The Visual Novel Database',
    note: '提供了本项目使用的数据库',
    href: 'https://vndb.org/',
    analyticsEvent: 'home-special-thanks-vndb',
  },
  {
    name: '月幕galgame',
    note: '提供了本项目使用的数据库',
    image: ymgalImage,
    href: 'https://www.ymgal.games/',
    analyticsEvent: 'home-special-thanks-ymgal',
  },
  {
    name: 'Bangumi',
    note: '提供了本项目使用的数据库',
    image: bangumiImage,
    href: 'https://bangumi.tv/',
    analyticsEvent: 'home-special-thanks-bangumi',
  },
];

if (SPECIAL_THANKS.length > 10) {
  throw new Error('SPECIAL_THANKS_LIMIT_EXCEEDED');
}
