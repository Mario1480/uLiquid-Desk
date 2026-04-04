import type {
  CustomIndicator,
  IPineStudyResult,
  IContext,
  LibraryPineStudy,
  PineJS,
  StudyScript
} from "../../public/static/charting_library/charting_library";
import {
  PVSRA_BLUE,
  PVSRA_GREEN,
  PVSRA_RED,
  PVSRA_REGULAR_DOWN,
  PVSRA_REGULAR_UP,
  PVSRA_VIOLET
} from "../../src/trade/pvsraColor";

export type AdvancedCustomIndicator = CustomIndicator | StudyScript;

const PVSRA_LOOKBACK = 10;
const EMA_CLOUD_LENGTH = 50;
const EMA_CLOUD_STDEV_LENGTH = 100;
const FILLED_AREA_TYPE_PLOTS = "plot_plot";
const OHLC_PLOT_STYLE_CANDLES = "ohlc_candles";
const STUDY_PLOT_TYPE_LINE = "line";
const STUDY_PLOT_TYPE_OHLC_OPEN = "ohlc_open";
const STUDY_PLOT_TYPE_OHLC_HIGH = "ohlc_high";
const STUDY_PLOT_TYPE_OHLC_LOW = "ohlc_low";
const STUDY_PLOT_TYPE_OHLC_CLOSE = "ohlc_close";
const STUDY_PLOT_TYPE_OHLC_COLORER = "ohlc_colorer";
const STUDY_PLOT_TYPE_WICK_COLORER = "wick_colorer";
const STUDY_PLOT_TYPE_BORDER_COLORER = "border_colorer";

function createTrEmaCloudIndicator(Pine: PineJS): CustomIndicator {
  return {
    name: "TR EMA Cloud 50",
    metainfo: {
      _metainfoVersion: 53,
      id: "TREmaCloud50@tv-basicstudies-1" as never,
      name: "TR EMA Cloud 50",
      description: "TR EMA Cloud 50",
      shortDescription: "TR EMA Cloud",
      isCustomIndicator: true,
      is_price_study: true,
      linkedToSeries: true,
      format: { type: "inherit" },
      plots: [
        { id: "upper", type: STUDY_PLOT_TYPE_LINE as never },
        { id: "lower", type: STUDY_PLOT_TYPE_LINE as never }
      ],
      filledAreas: [
        {
          id: "ema_cloud_fill",
          objAId: "upper",
          objBId: "lower",
          title: "EMA 50 Cloud",
          type: FILLED_AREA_TYPE_PLOTS as never
        }
      ],
      defaults: {
        styles: {
          upper: {
            color: "#12897b",
            linestyle: 0,
            linewidth: 1,
            plottype: 0,
            trackPrice: false,
            transparency: 0,
            visible: true
          },
          lower: {
            color: "#12897b",
            linestyle: 0,
            linewidth: 1,
            plottype: 0,
            trackPrice: false,
            transparency: 0,
            visible: true
          }
        },
        filledAreasStyle: {
          ema_cloud_fill: {
            color: "#9b2fae",
            transparency: 60,
            visible: true
          }
        },
        inputs: {}
      },
      styles: {
        upper: { title: "Upper 50 Ema Cloud", histogramBase: 0, joinPoints: true },
        lower: { title: "Lower 50 Ema Cloud", histogramBase: 0, joinPoints: true }
      },
      inputs: []
    },
    constructor: function (this: LibraryPineStudy<IPineStudyResult>) {
      this.main = function (ctx: IContext) {
        this._context = ctx;
        this._context.setMinimumAdditionalDepth(EMA_CLOUD_STDEV_LENGTH);

        const close = Pine.Std.close(this._context);
        const closeSeries = this._context.new_var(close);
        const ema50 = Pine.Std.ema(closeSeries, EMA_CLOUD_LENGTH, this._context);
        const stdev = Pine.Std.stdev(closeSeries, EMA_CLOUD_STDEV_LENGTH, this._context);
        const cloudSize = Number.isFinite(stdev) ? stdev / 4 : NaN;

        return [
          Number.isFinite(ema50) && Number.isFinite(cloudSize) ? ema50 + cloudSize : NaN,
          Number.isFinite(ema50) && Number.isFinite(cloudSize) ? ema50 - cloudSize : NaN
        ];
      };
    }
  };
}

function createTrPvsraCandlesIndicator(Pine: PineJS): CustomIndicator {
  return {
    name: "TR PVSRA Candles",
    metainfo: {
      _metainfoVersion: 53,
      id: "TRPvsraCandles@tv-basicstudies-1" as never,
      name: "TR PVSRA Candles",
      description: "TR PVSRA Candles",
      shortDescription: "TR PVSRA",
      isCustomIndicator: true,
      is_price_study: true,
      linkedToSeries: true,
      format: { type: "inherit" },
      plots: [
        { id: "plot_open", type: STUDY_PLOT_TYPE_OHLC_OPEN as never, target: "plot_candle" },
        { id: "plot_high", type: STUDY_PLOT_TYPE_OHLC_HIGH as never, target: "plot_candle" },
        { id: "plot_low", type: STUDY_PLOT_TYPE_OHLC_LOW as never, target: "plot_candle" },
        { id: "plot_close", type: STUDY_PLOT_TYPE_OHLC_CLOSE as never, target: "plot_candle" },
        { id: "plot_bar_color", type: STUDY_PLOT_TYPE_OHLC_COLORER as never, palette: "palette_bar", target: "plot_candle" },
        { id: "plot_wick_color", type: STUDY_PLOT_TYPE_WICK_COLORER as never, palette: "palette_wick", target: "plot_candle" },
        { id: "plot_border_color", type: STUDY_PLOT_TYPE_BORDER_COLORER as never, palette: "palette_border", target: "plot_candle" }
      ],
      ohlcPlots: {
        plot_candle: {
          title: "Candles"
        }
      },
      defaults: {
        ohlcPlots: {
          plot_candle: {
            display: 15,
            borderColor: PVSRA_REGULAR_DOWN,
            color: PVSRA_REGULAR_UP,
            drawBorder: true,
            drawWick: true,
            plottype: OHLC_PLOT_STYLE_CANDLES as never,
            visible: true,
            wickColor: PVSRA_REGULAR_DOWN
          } as never
        },
        palettes: {
          palette_bar: {
            colors: [
              { color: PVSRA_RED },
              { color: PVSRA_GREEN },
              { color: PVSRA_VIOLET },
              { color: PVSRA_BLUE },
              { color: PVSRA_REGULAR_UP },
              { color: PVSRA_REGULAR_DOWN }
            ]
          },
          palette_wick: {
            colors: [
              { color: PVSRA_RED },
              { color: PVSRA_GREEN },
              { color: PVSRA_VIOLET },
              { color: PVSRA_BLUE },
              { color: PVSRA_REGULAR_UP },
              { color: PVSRA_REGULAR_DOWN }
            ]
          },
          palette_border: {
            colors: [
              { color: PVSRA_RED },
              { color: PVSRA_GREEN },
              { color: PVSRA_VIOLET },
              { color: PVSRA_BLUE },
              { color: PVSRA_REGULAR_UP },
              { color: PVSRA_REGULAR_DOWN }
            ]
          }
        },
        inputs: {}
      },
      palettes: {
        palette_bar: {
          colors: [
            { name: "Red Vector" },
            { name: "Green Vector" },
            { name: "Violet Vector" },
            { name: "Blue Vector" },
            { name: "Regular Up" },
            { name: "Regular Down" }
          ],
          valToIndex: {
            0: 0,
            1: 1,
            2: 2,
            3: 3,
            4: 4,
            5: 5
          }
        },
        palette_wick: {
          colors: [
            { name: "Red Vector" },
            { name: "Green Vector" },
            { name: "Violet Vector" },
            { name: "Blue Vector" },
            { name: "Regular Up" },
            { name: "Regular Down" }
          ],
          valToIndex: {
            0: 0,
            1: 1,
            2: 2,
            3: 3,
            4: 4,
            5: 5
          }
        },
        palette_border: {
          colors: [
            { name: "Red Vector" },
            { name: "Green Vector" },
            { name: "Violet Vector" },
            { name: "Blue Vector" },
            { name: "Regular Up" },
            { name: "Regular Down" }
          ],
          valToIndex: {
            0: 0,
            1: 1,
            2: 2,
            3: 3,
            4: 4,
            5: 5
          }
        }
      },
      styles: {},
      inputs: []
    },
    constructor: function (this: LibraryPineStudy<IPineStudyResult>) {
      this.main = function (ctx: IContext) {
        this._context = ctx;
        this._context.setMinimumAdditionalDepth(PVSRA_LOOKBACK + 2);

        const open = Pine.Std.open(this._context);
        const high = Pine.Std.high(this._context);
        const low = Pine.Std.low(this._context);
        const close = Pine.Std.close(this._context);
        const volume = Pine.Std.volume(this._context);

        const volumeSeries = this._context.new_var(volume);
        const spread = Math.max(0, high - low);
        const volumeSpreadSeries = this._context.new_var(spread * volume);

        const avgVol10 = Pine.Std.sma(volumeSeries, PVSRA_LOOKBACK, this._context);
        const highestVolSpread10 = Pine.Std.highest(volumeSpreadSeries, PVSRA_LOOKBACK, this._context);

        const bullish = close >= open;
        const volumeExtreme = Number.isFinite(avgVol10) && avgVol10 > 0 && volume >= avgVol10 * 2;
        const spreadExtreme = Number.isFinite(highestVolSpread10) && highestVolSpread10 > 0 && (spread * volume) >= highestVolSpread10 * 0.999;
        const volumeHigh = Number.isFinite(avgVol10) && avgVol10 > 0 && volume >= avgVol10 * 1.5;

        let colorIndex = bullish ? 4 : 5;
        if (volumeExtreme || spreadExtreme) {
          colorIndex = bullish ? 1 : 0;
        } else if (volumeHigh) {
          colorIndex = bullish ? 3 : 2;
        }

        return [
          open,
          high,
          low,
          close,
          colorIndex,
          colorIndex,
          colorIndex
        ];
      };
    }
  };
}

export async function getAdvancedCustomIndicators(pineJs: PineJS): Promise<readonly AdvancedCustomIndicator[]> {
  return [
    createTrEmaCloudIndicator(pineJs),
    createTrPvsraCandlesIndicator(pineJs)
  ];
}
