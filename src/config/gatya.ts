export interface GatyaDataUrls {
  gachaJson: string;
  itemJson: string;
  saleNames: string;
  gachaNames: Readonly<Record<"R" | "E" | "N", string>>;
  seriesNames?: Readonly<Partial<Record<"R" | "E" | "N", string>>>;
  shortSeriesNames?: Readonly<Partial<Record<"R" | "E" | "N", string>>>;
  seriesMappings: Readonly<Record<"R" | "E" | "N", string>>;
}

const eventDataBaseUrl =
  "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-event/main/data";
const assetDataBaseUrl =
  "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-assets/main/jp/sitedata/Data";

export const gatyaDataUrls: GatyaDataUrls = {
  gachaJson: `${eventDataBaseUrl}/gatya.json`,
  itemJson: `${eventDataBaseUrl}/item.json`,
  saleNames: `${eventDataBaseUrl}/sale_name.csv`,
  gachaNames: {
    R: `${eventDataBaseUrl}/gatya_name.csv`,
    E: `${eventDataBaseUrl}/gatya_e_name.csv`,
    N: `${eventDataBaseUrl}/gatya_n_name.csv`,
  },
  seriesNames: {
    R: `${eventDataBaseUrl}/gatya_series_name.csv`,
    E: `${eventDataBaseUrl}/gatya_e_series_name.csv`,
    N: `${eventDataBaseUrl}/gatya_n_series_name.csv`,
  },
  shortSeriesNames: {
    R: `${eventDataBaseUrl}/gatya_series_name_omit.csv`,
    E: `${eventDataBaseUrl}/gatya_e_series_name_omit.csv`,
    N: `${eventDataBaseUrl}/gatya_n_series_nameomit.csv`,
  },
  seriesMappings: {
    R: `${assetDataBaseUrl}/GatyaData_Option_SetR.tsv`,
    E: `${assetDataBaseUrl}/GatyaData_Option_SetE.tsv`,
    N: `${assetDataBaseUrl}/GatyaData_Option_SetN.tsv`,
  },
};

export const gatyaHttpTimeoutMs = 10_000;
