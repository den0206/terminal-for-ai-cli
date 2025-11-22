#!/usr/bin/env node

/**
 * PNG画像の白い背景を透過させるスクリプト
 * 使用方法: node scripts/make-transparent.mjs [入力ファイル] [出力ファイル]
 *
 * 注意: sharpライブラリが必要です
 * インストール: npm install --save-dev sharp
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function makeTransparent(inputPath, outputPath) {
  try {
    // sharpがインストールされているか確認
    let sharp;
    try {
      sharp = (await import('sharp')).default;
    } catch (e) {
      console.error('❌ Error: sharpライブラリが必要です。');
      console.error('📦 インストール方法: npm install --save-dev sharp');
      console.error('');
      console.error('💡 代替方法: Preview.appを使用して手動で透過させることもできます。');
      process.exit(1);
    }

    console.log(`📖 画像を読み込んでいます: ${inputPath}`);

    // 画像を読み込んで、アルファチャンネルを追加
    const image = sharp(inputPath);
    const metadata = await image.metadata();

    console.log(`📐 画像サイズ: ${metadata.width}x${metadata.height}`);

    // ピクセルデータを取得
    const { data, info } = await image
      .ensureAlpha() // アルファチャンネルを追加
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    let transparentPixels = 0;

    // 各ピクセルを処理して白い部分を透過させる
    for (let i = 0; i < data.length; i += channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // 白に近い色を透過させる（閾値を調整可能）
      // デフォルトでは完全に白（255,255,255）のみを透過
      // より広範囲に透過させる場合は threshold を下げる（例: 250, 240）
      const threshold = 255; // 255 = 完全に白のみ、250 = 白に近い色も透過

      if (r >= threshold && g >= threshold && b >= threshold) {
        // アルファチャンネルを0（完全に透明）に設定
        if (channels >= 4) {
          data[i + 3] = 0;
          transparentPixels++;
        }
      }
    }

    console.log(`✨ ${transparentPixels}個のピクセルを透過させました`);

    // 処理した画像を保存
    await sharp(data, {
      raw: {
        width: info.width,
        height: info.height,
        channels: info.channels,
      },
    })
      .png()
      .toFile(outputPath);

    console.log(`✅ 透過PNGを作成しました: ${outputPath}`);
  } catch (error) {
    console.error('❌ エラーが発生しました:', error.message);
    process.exit(1);
  }
}

// コマンドライン引数を処理
const args = process.argv.slice(2);
const inputPath = args[0] || join(__dirname, '../media/icon-bit.png');
const outputPath = args[1] || join(__dirname, '../media/icon-bit.png'); // 元のファイルを上書き

if (args.length === 0) {
  console.log('使用方法: node scripts/make-transparent.mjs [入力ファイル] [出力ファイル]');
  console.log('例: node scripts/make-transparent.mjs media/icon-bit.png media/icon-bit-transparent.png');
  process.exit(0);
}

makeTransparent(inputPath, outputPath);

