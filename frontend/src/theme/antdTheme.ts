import { theme as antdThemeCore, type ThemeConfig } from 'antd';
import { defaultDisplayDensity, densityTokens, type DisplayDensity } from './density';
import { designTokens } from './tokens';
import { defaultThemeMode, type ThemeMode } from './themeMode';

interface ThemePalette {
  colorPrimary: string;
  colorPrimaryHover: string;
  colorInfo: string;
  colorLink: string;
  colorBgPage: string;
  colorBgCard: string;
  colorBgCardMuted: string;
  colorBgHeader: string;
  colorBgSidebar: string;
  colorTextPrimary: string;
  colorTextSecondary: string;
  colorTextMuted: string;
  colorBorder: string;
  colorBorderSoft: string;
  colorBorderStrong: string;
  colorFillSecondary: string;
  colorFillTertiary: string;
  colorDisabled: string;
  controlBg: string;
  controlBgElevated: string;
  tableHeaderBg: string;
  tableHoverBg: string;
  buttonDefaultBg: string;
  buttonDefaultColor: string;
  selectOptionBg: string;
}

const palettes: Record<ThemeMode, ThemePalette> = {
  dark: {
    colorPrimary: designTokens.colorPrimary,
    colorPrimaryHover: designTokens.colorPrimaryHover,
    colorInfo: designTokens.colorInfo,
    colorLink: designTokens.colorInfo,
    colorBgPage: designTokens.colorBgPage,
    colorBgCard: designTokens.colorBgCard,
    colorBgCardMuted: designTokens.colorBgCardMuted,
    colorBgHeader: designTokens.colorBgHeader,
    colorBgSidebar: designTokens.colorBgSidebar,
    colorTextPrimary: designTokens.colorTextPrimary,
    colorTextSecondary: designTokens.colorTextSecondary,
    colorTextMuted: designTokens.colorTextMuted,
    colorBorder: designTokens.colorBorder,
    colorBorderSoft: designTokens.colorBorderSoft,
    colorBorderStrong: designTokens.colorBorderStrong,
    colorFillSecondary: 'rgba(148, 163, 184, 0.12)',
    colorFillTertiary: 'rgba(148, 163, 184, 0.08)',
    colorDisabled: '#0d1118',
    controlBg: '#11131b',
    controlBgElevated: '#11131b',
    tableHeaderBg: '#151821',
    tableHoverBg: '#1b2331',
    buttonDefaultBg: '#151923',
    buttonDefaultColor: '#d8dee9',
    selectOptionBg: '#1b2331',
  },
  light: {
    colorPrimary: '#0a58ca',
    colorPrimaryHover: '#084db4',
    colorInfo: '#0a58ca',
    colorLink: '#0a58ca',
    colorBgPage: '#edf2f8',
    colorBgCard: '#ffffff',
    colorBgCardMuted: '#f6f8fb',
    colorBgHeader: '#ffffff',
    colorBgSidebar: '#f8fafc',
    colorTextPrimary: '#172033',
    colorTextSecondary: '#526071',
    colorTextMuted: '#5f6f83',
    colorBorder: '#d4deeb',
    colorBorderSoft: '#dce5f0',
    colorBorderStrong: '#bfccd9',
    colorFillSecondary: 'rgba(11, 91, 211, 0.08)',
    colorFillTertiary: 'rgba(15, 23, 42, 0.04)',
    colorDisabled: '#f2f5f9',
    controlBg: '#ffffff',
    controlBgElevated: '#ffffff',
    tableHeaderBg: '#f2f5fa',
    tableHoverBg: '#eef5ff',
    buttonDefaultBg: '#ffffff',
    buttonDefaultColor: '#1f2a3a',
    selectOptionBg: '#eaf2ff',
  },
};

export function createAntdTheme(
  density: DisplayDensity = defaultDisplayDensity,
  mode: ThemeMode = defaultThemeMode,
): ThemeConfig {
  const densityToken = densityTokens[density];
  const palette = palettes[mode];

  return {
    algorithm: [
      mode === 'light' ? antdThemeCore.defaultAlgorithm : antdThemeCore.darkAlgorithm,
      antdThemeCore.compactAlgorithm,
    ],
    token: {
      colorPrimary: palette.colorPrimary,
      colorPrimaryHover: palette.colorPrimaryHover,
      colorInfo: palette.colorInfo,
      colorLink: palette.colorLink,
      colorLinkHover: palette.colorPrimaryHover,
      colorSuccess: designTokens.colorSuccess,
      colorWarning: designTokens.colorWarning,
      colorError: designTokens.colorDanger,
      colorText: palette.colorTextPrimary,
      colorTextSecondary: palette.colorTextSecondary,
      colorBorder: palette.colorBorder,
      colorBorderSecondary: palette.colorBorderSoft,
      colorBgLayout: palette.colorBgPage,
      colorBgContainer: palette.colorBgCard,
      colorBgElevated: palette.colorBgCard,
      colorBgContainerDisabled: palette.colorDisabled,
      colorFillAlter: palette.colorBgCardMuted,
      colorFillSecondary: palette.colorFillSecondary,
      colorFillTertiary: palette.colorFillTertiary,
      colorTextPlaceholder: palette.colorTextMuted,
      colorIcon: palette.colorTextSecondary,
      colorIconHover: palette.colorTextPrimary,
      borderRadius: densityToken.borderRadius,
      borderRadiusLG: designTokens.radiusCard,
      fontFamily: designTokens.fontUi,
      fontFamilyCode: designTokens.fontCode,
      fontSize: densityToken.fontSize,
      fontSizeSM: densityToken.fontSizeSM,
      controlHeight: densityToken.controlHeight,
      controlHeightSM: densityToken.controlHeightSM,
      controlHeightLG: 30,
      padding: densityToken.cardPadding,
      paddingSM: Math.max(densityToken.cardPadding - 2, 8),
      paddingXS: 6,
      margin: densityToken.cardPadding,
      marginSM: Math.max(densityToken.cardPadding - 2, 8),
      marginXS: 6,
      wireframe: false,
    },
    components: {
      Layout: {
        bodyBg: palette.colorBgPage,
        headerBg: palette.colorBgHeader,
        siderBg: palette.colorBgSidebar,
      },
      Menu: {
        darkItemBg: designTokens.colorBgSidebar,
        darkSubMenuItemBg: designTokens.colorBgSidebar,
        darkItemColor: '#b8c5d6',
        darkItemHoverColor: '#ffffff',
        darkItemHoverBg: 'rgba(88, 166, 255, 0.14)',
        darkItemSelectedBg: 'rgba(88, 166, 255, 0.22)',
        darkItemSelectedColor: '#ffffff',
        itemBg: palette.colorBgSidebar,
        itemColor: palette.colorTextSecondary,
        itemHoverColor: palette.colorLink,
        itemHoverBg: mode === 'light' ? '#edf4ff' : 'rgba(88, 166, 255, 0.14)',
        itemSelectedBg: mode === 'light' ? '#e6f0ff' : 'rgba(88, 166, 255, 0.22)',
        itemSelectedColor: mode === 'light' ? palette.colorLink : '#ffffff',
        itemBorderRadius: densityToken.borderRadius,
        itemHeight: densityToken.controlHeight + 4,
      },
      Card: {
        borderRadiusLG: designTokens.radiusCard,
        headerFontSize: densityToken.fontSize + 1,
        colorBorderSecondary: palette.colorBorderSoft,
        colorBgContainer: palette.colorBgCard,
        paddingLG: densityToken.cardPadding,
      },
      Table: {
        headerBg: palette.tableHeaderBg,
        headerColor: palette.colorTextPrimary,
        rowHoverBg: palette.tableHoverBg,
        borderColor: palette.colorBorderSoft,
        colorBgContainer: palette.colorBgCard,
        colorText: palette.colorTextPrimary,
        colorTextHeading: palette.colorTextSecondary,
        cellFontSize: densityToken.fontSize,
        cellFontSizeSM: densityToken.fontSize,
        cellPaddingBlock: densityToken.tableCellPaddingBlock,
        cellPaddingInline: densityToken.tableCellPaddingInline,
        cellPaddingBlockSM: densityToken.tableCellPaddingBlock,
        cellPaddingInlineSM: densityToken.tableCellPaddingInline,
      },
      Tabs: {
        itemSelectedColor: palette.colorLink,
        inkBarColor: palette.colorLink,
        horizontalMargin: '0 18px 0 0',
        titleFontSize: densityToken.fontSize,
      },
      Button: {
        borderRadius: densityToken.borderRadius,
        controlHeight: densityToken.controlHeight,
        controlHeightSM: densityToken.controlHeightSM,
        defaultBg: palette.buttonDefaultBg,
        defaultBorderColor: palette.colorBorderStrong,
        defaultColor: palette.buttonDefaultColor,
      },
      Input: {
        controlHeight: densityToken.controlHeight,
        controlHeightSM: densityToken.controlHeightSM,
        colorBgContainer: palette.controlBg,
        colorBorder: palette.colorBorderStrong,
        colorText: palette.colorTextPrimary,
      },
      Select: {
        controlHeight: densityToken.controlHeight,
        controlHeightSM: densityToken.controlHeightSM,
        colorBgContainer: palette.controlBg,
        colorBgElevated: palette.controlBgElevated,
        colorBorder: palette.colorBorderStrong,
        optionSelectedBg: palette.selectOptionBg,
        optionActiveBg: palette.selectOptionBg,
      },
      DatePicker: {
        controlHeight: densityToken.controlHeight,
        controlHeightSM: densityToken.controlHeightSM,
        colorBgContainer: palette.controlBg,
        colorBgElevated: palette.controlBgElevated,
        colorBorder: palette.colorBorderStrong,
      },
      Switch: {
        colorPrimary: mode === 'light' ? '#bfdbfe' : palette.colorPrimary,
        colorPrimaryHover: mode === 'light' ? '#dbeafe' : palette.colorPrimaryHover,
        colorTextQuaternary: mode === 'light' ? palette.colorDisabled : palette.colorBorderStrong,
        colorTextTertiary: mode === 'light' ? palette.colorDisabled : palette.colorBorderStrong,
        handleBg: mode === 'light' ? palette.colorPrimary : '#ffffff',
      },
    },
  };
}

export const antdTheme: ThemeConfig = createAntdTheme(defaultDisplayDensity);
