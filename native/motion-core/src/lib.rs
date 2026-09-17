use std::collections::{HashMap, HashSet};

use napi::bindgen_prelude::*;
use napi_derive::napi;
use num_bigint::BigInt;
use serde::Serialize;

const TWO_PI: f64 = std::f64::consts::PI * 2.0;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImgCut {
    version: i64,
    image_name: String,
    cuts: Vec<Cut>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Cut {
    index: usize,
    x: i64,
    y: i64,
    width: i64,
    height: i64,
    name: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MaModel {
    version: i64,
    parts: Vec<ModelPart>,
    scale_unit: i64,
    angle_unit: i64,
    opacity_unit: i64,
    configs: Vec<ModelConfig>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelPart {
    index: usize,
    parent: i64,
    id: i64,
    image_index: i64,
    z_index: i64,
    x: i64,
    y: i64,
    pivot_x: i64,
    pivot_y: i64,
    scale_x: i64,
    scale_y: i64,
    angle: i64,
    opacity: i64,
    glow: i64,
    name: String,
    values: Vec<i64>,
}

#[derive(Clone, Serialize)]
struct ModelConfig {
    values: Vec<i64>,
    name: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MaAnim {
    version: i64,
    tracks: Vec<Track>,
    max_frame: i64,
    frame_count: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Track {
    part_index: i64,
    property: i64,
    #[serde(rename = "loop")]
    loop_value: i64,
    min: i64,
    max: i64,
    name: String,
    keys: Vec<KeyFrame>,
    first_frame: i64,
    last_frame: i64,
    offset: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyFrame {
    frame: i64,
    value: i64,
    easing: i64,
    easing_power: i64,
}

#[derive(Clone)]
struct PartState {
    base_index: usize,
    parent: i64,
    id: i64,
    image_index: i64,
    z_index: i64,
    z_order: i64,
    x: f64,
    y: f64,
    pivot_x: f64,
    pivot_y: f64,
    scale_factor_x: f64,
    scale_factor_y: f64,
    opacity_factor: f64,
    angle: f64,
    glow: i64,
    flip_x: i64,
    flip_y: i64,
    scale_x: f64,
    scale_y: f64,
    opacity: f64,
    native_scale_x: f64,
    native_scale_y: f64,
    native_opacity: f64,
    native_flip_x: bool,
    native_flip_y: bool,
    matrix: Option<[f64; 6]>,
    vertices: Option<[[f64; 2]; 4]>,
    uses_interpolated_math: bool,
}

#[napi(object)]
pub struct MotionSource {
    pub key: String,
    pub text: String,
}

#[napi(object)]
pub struct DrawOptions {
    pub origin_x: Option<f64>,
    pub origin_y: Option<f64>,
    pub scale: Option<f64>,
    pub facing: Option<i32>,
    pub alpha: Option<f64>,
    pub use_model_anchor: Option<bool>,
    pub interpolate: Option<bool>,
}

#[napi(object)]
pub struct DrawPacket {
    pub part_index: i32,
    pub blend_mode: i32,
    pub opacity: f64,
    pub positions: Vec<f64>,
    pub uvs: Vec<f64>,
}

#[napi(object)]
pub struct CompactFrameSet {
    pub data: Buffer,
    pub offsets: Vec<u32>,
    pub packet_counts: Vec<u32>,
}

struct MotionProject {
    imgcut: ImgCut,
    model: MaModel,
    motions: HashMap<String, MaAnim>,
    image_width: f64,
    image_height: f64,
}

#[napi]
pub struct MotionCoreProject {
    project: MotionProject,
}

fn invalid(message: impl Into<String>) -> Error {
    Error::from_reason(message.into())
}

fn read_lines(text: &str) -> Vec<&str> {
    text.trim_start_matches('\u{feff}')
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect()
}

fn read_integer(line: Option<&&str>, label: &str) -> Result<i64> {
    line.copied()
        .unwrap_or("")
        .parse::<i64>()
        .map_err(|_| invalid(format!("{label} が整数ではありません: {}", line.copied().unwrap_or(""))))
}

fn read_integer_columns(line: Option<&&str>, count: usize, label: &str) -> Result<(Vec<i64>, String)> {
    let raw = line.copied().unwrap_or("");
    let columns: Vec<&str> = raw.split(',').collect();
    if columns.len() < count {
        return Err(invalid(format!("{label} の列数が不足しています: {raw}")));
    }
    let mut values = Vec::with_capacity(count);
    for (index, column) in columns.iter().take(count).enumerate() {
        values.push(column.trim().parse::<i64>().map_err(|_| {
            invalid(format!("{label} の {} 列目が整数ではありません: {raw}", index + 1))
        })?);
    }
    Ok((values, columns[count..].join(",").trim().to_owned()))
}

fn assert_header(lines: &[&str], expected: &[&str], label: &str) -> Result<()> {
    let actual = lines.first().copied().unwrap_or("").to_ascii_lowercase();
    if expected.iter().any(|value| *value == actual) {
        Ok(())
    } else {
        Err(invalid(format!("{label} のヘッダーが不正です: {}", lines.first().copied().unwrap_or("(空)"))))
    }
}

fn parse_img_cut(text: &str) -> Result<ImgCut> {
    let lines = read_lines(text);
    assert_header(&lines, &["[imgcut]"], "imgcut")?;
    let version = read_integer(lines.get(1), "imgcutのバージョン")?;
    let image_name = lines.get(2).copied().unwrap_or("").to_owned();
    let cut_count = read_integer(lines.get(3), "imgcutの分割数")?;
    if image_name.is_empty() || cut_count < 0 {
        return Err(invalid("imgcut の画像名または分割数が不正です"));
    }
    let mut cuts = Vec::with_capacity(cut_count as usize);
    for index in 0..cut_count as usize {
        let (values, name) = read_integer_columns(lines.get(4 + index), 4, &format!("imgcut #{index}"))?;
        cuts.push(Cut {
            index,
            x: values[0],
            y: values[1],
            width: values[2],
            height: values[3],
            name,
        });
    }
    Ok(ImgCut { version, image_name, cuts })
}

fn validate_static_parents(parts: &[ModelPart]) -> Result<()> {
    for part in parts {
        if part.parent < -1 || part.parent >= parts.len() as i64 || part.parent == part.index as i64 {
            return Err(invalid(format!("mamodel part #{} の親番号が不正です: {}", part.index, part.parent)));
        }
    }
    for part in parts {
        let mut visited = HashSet::from([part.index as i64]);
        let mut parent_index = part.parent;
        while parent_index >= 0 {
            if !visited.insert(parent_index) {
                return Err(invalid(format!("mamodel part #{} の親関係が循環しています", part.index)));
            }
            parent_index = parts[parent_index as usize].parent;
        }
    }
    Ok(())
}

fn parse_ma_model(text: &str) -> Result<MaModel> {
    let lines = read_lines(text);
    assert_header(&lines, &["[modelanim:model]", "[modelanim:model2]", "[mamodel]"], "mamodel")?;
    let version = read_integer(lines.get(1), "mamodelのバージョン")?;
    let part_count = read_integer(lines.get(2), "mamodelのパーツ数")?;
    if part_count <= 0 {
        return Err(invalid("mamodel のパーツ数が不正です"));
    }
    let mut cursor = 3;
    let mut parts = Vec::with_capacity(part_count as usize);
    for index in 0..part_count as usize {
        let (values, name) = read_integer_columns(lines.get(cursor), 13, &format!("mamodel part #{index}"))?;
        cursor += 1;
        parts.push(ModelPart {
            index,
            parent: values[0], id: values[1], image_index: values[2], z_index: values[3],
            x: values[4], y: values[5], pivot_x: values[6], pivot_y: values[7],
            scale_x: values[8], scale_y: values[9], angle: values[10], opacity: values[11],
            glow: values[12], name, values,
        });
    }
    let (mut scale_unit, mut angle_unit, mut opacity_unit) = (100, 360, 255);
    if version >= 1 {
        let (values, _) = read_integer_columns(lines.get(cursor), 3, "mamodelの基準値")?;
        cursor += 1;
        scale_unit = values[0];
        angle_unit = values[1];
        opacity_unit = values[2];
    }
    if scale_unit == 0 || angle_unit == 0 || opacity_unit == 0 {
        return Err(invalid("mamodel の基準値に 0 は指定できません"));
    }
    let mut configs = Vec::new();
    if version >= 3 {
        let config_count = read_integer(lines.get(cursor), "mamodelの設定数")?;
        cursor += 1;
        if config_count < 0 {
            return Err(invalid("mamodel の設定数が不正です"));
        }
        for index in 0..config_count as usize {
            let (values, name) = read_integer_columns(lines.get(cursor), 6, &format!("mamodel config #{index}"))?;
            cursor += 1;
            configs.push(ModelConfig { values, name });
        }
    }
    validate_static_parents(&parts)?;
    Ok(MaModel { version, parts, scale_unit, angle_unit, opacity_unit, configs })
}

fn parse_ma_anim(text: &str) -> Result<MaAnim> {
    let lines = read_lines(text);
    assert_header(&lines, &["[modelanim:animation]", "[modelanim:animation2]", "[maanim]"], "maanim")?;
    let version = read_integer(lines.get(1), "maanimのバージョン")?;
    let track_count = read_integer(lines.get(2), "maanimのトラック数")?;
    if track_count < 0 {
        return Err(invalid("maanim のトラック数が不正です"));
    }
    let mut cursor = 3;
    let mut tracks = Vec::with_capacity(track_count as usize);
    for index in 0..track_count as usize {
        let (header, name) = read_integer_columns(lines.get(cursor), 5, &format!("maanim track #{index}"))?;
        cursor += 1;
        let key_count = read_integer(lines.get(cursor), &format!("maanim track #{index} のキー数"))?;
        cursor += 1;
        if key_count < 0 {
            return Err(invalid(format!("maanim track #{index} のキー数が不正です")));
        }
        let mut keys = Vec::with_capacity(key_count as usize);
        for key_index in 0..key_count as usize {
            let (values, _) = read_integer_columns(
                lines.get(cursor), 4, &format!("maanim track #{index} key #{key_index}"),
            )?;
            cursor += 1;
            if !(0..=3).contains(&values[2]) {
                return Err(invalid(format!(
                    "maanim track #{index} key #{key_index} の補間 {} はv15.5.0で未対応です",
                    values[2],
                )));
            }
            keys.push(KeyFrame { frame: values[0], value: values[1], easing: values[2], easing_power: values[3] });
        }
        let loop_value = header[2];
        let offset = if keys.is_empty() { 0 } else if keys[0].frame < 0 || loop_value != 1 { -keys[0].frame } else { 0 };
        for key in &mut keys {
            key.frame += offset;
        }
        tracks.push(Track {
            part_index: header[0], property: header[1], loop_value, min: header[3], max: header[4], name,
            first_frame: keys.first().map(|key| key.frame).unwrap_or(0),
            last_frame: keys.last().map(|key| key.frame).unwrap_or(0),
            keys, offset,
        });
    }
    let max_frame = tracks.iter().map(get_track_max_frame).max().unwrap_or(1).max(1);
    Ok(MaAnim { version, tracks, max_frame, frame_count: max_frame + 1 })
}

fn get_track_max_frame(track: &Track) -> i64 {
    if track.keys.is_empty() {
        0
    } else if track.loop_value != -1 {
        if track.loop_value > 1 {
            track.first_frame + (track.last_frame - track.first_frame) * track.loop_value - track.offset
        } else {
            track.last_frame - track.offset
        }
    } else {
        track.last_frame - track.offset.min(0)
    }
}

fn reset_part(base: &ModelPart, part_count: usize, model: &MaModel) -> PartState {
    PartState {
        base_index: base.index,
        parent: base.parent,
        id: base.id,
        image_index: base.image_index,
        z_index: base.z_index,
        z_order: base.z_index * part_count as i64 + base.index as i64,
        x: base.x as f64,
        y: base.y as f64,
        pivot_x: base.pivot_x as f64,
        pivot_y: base.pivot_y as f64,
        scale_factor_x: model.scale_unit as f64,
        scale_factor_y: model.scale_unit as f64,
        opacity_factor: model.opacity_unit as f64,
        angle: base.angle as f64,
        glow: base.glow,
        flip_x: 1,
        flip_y: 1,
        scale_x: base.scale_x as f64,
        scale_y: base.scale_y as f64,
        opacity: base.opacity as f64,
        native_scale_x: 0.0,
        native_scale_y: 0.0,
        native_opacity: 0.0,
        native_flip_x: false,
        native_flip_y: false,
        matrix: None,
        vertices: None,
        uses_interpolated_math: false,
    }
}

fn positive_modulo(value: i64, divisor: i64) -> i64 {
    if divisor == 0 { 0 } else { ((value % divisor) + divisor) % divisor }
}

fn resolve_track_frame(track: &Track, animation_frame: i64, animation_max_frame: i64) -> i64 {
    let loop_length = track.last_frame - track.first_frame;
    let modulus = if track.loop_value == -1 { track.last_frame } else { animation_max_frame + 1 };
    let mut frame = if modulus == 0 { 0 } else { positive_modulo(animation_frame + track.offset, modulus) };
    if track.loop_value > 0 && loop_length != 0 {
        if frame > track.first_frame + track.loop_value * loop_length {
            return track.last_frame;
        }
        if frame > track.first_frame && frame < track.first_frame + track.loop_value * loop_length {
            frame = track.first_frame + positive_modulo(frame - track.first_frame, loop_length);
        } else if frame >= track.first_frame + track.loop_value * loop_length {
            frame = track.last_frame;
        }
    }
    frame
}

fn native_divide(numerator: f64, denominator: f64) -> Result<f64> {
    if denominator == 0.0 {
        Err(invalid("0では除算できません"))
    } else {
        Ok((numerator / denominator).trunc())
    }
}

fn divide_big_int_toward_zero(numerator: BigInt, denominator: BigInt) -> Result<BigInt> {
    if denominator == BigInt::from(0) {
        Err(invalid("ラグランジュ補間のフレームが重複しています"))
    } else {
        Ok(numerator / denominator)
    }
}

fn evaluate_lagrange(keys: &[KeyFrame], index: usize, frame: i64) -> Result<f64> {
    let mut low = index;
    let mut high = index;
    while low > 0 && keys[low - 1].easing == 3 { low -= 1; }
    while high < keys.len() - 1 {
        high += 1;
        if keys[high].easing != 3 { break; }
    }
    let mut sum = BigInt::from(0);
    for current in low..=high {
        let mut value = BigInt::from(keys[current].value) << 12;
        for other in low..=high {
            if other == current { continue; }
            value = divide_big_int_toward_zero(
                value * BigInt::from(frame - keys[other].frame),
                BigInt::from(keys[current].frame - keys[other].frame),
            )?;
        }
        sum += value;
    }
    let value = divide_big_int_toward_zero(sum, BigInt::from(4096))?;
    value.to_string().parse::<f64>().map_err(|_| invalid("ラグランジュ補間の結果が範囲外です"))
}

fn evaluate_track(track: &Track, frame: i64) -> Result<Option<f64>> {
    let keys = &track.keys;
    if keys.is_empty() || frame < keys[0].frame { return Ok(None); }
    for index in 0..keys.len() {
        let current = &keys[index];
        let next = keys.get(index + 1);
        if frame == current.frame { return Ok(Some(current.value as f64)); }
        let Some(next) = next else { continue };
        if frame <= current.frame || frame >= next.frame { continue; }
        if current.easing == 1 { return Ok(Some(current.value as f64)); }
        if current.easing == 3 { return evaluate_lagrange(keys, index, frame).map(Some); }
        let numerator = frame - current.frame;
        let denominator = next.frame - current.frame;
        if current.easing == 0 {
            return Ok(Some(current.value as f64 + native_divide(
                ((next.value - current.value) * numerator) as f64,
                denominator as f64,
            )?));
        }
        let progress = numerator as f64 / denominator as f64;
        let power = current.easing_power;
        let eased = if power < 0 {
            (1.0 - (1.0 - progress).powi((-power) as i32)).sqrt()
        } else {
            1.0 - (1.0 - progress.powi(power as i32)).sqrt()
        };
        return Ok(Some((current.value as f64 + (next.value - current.value) as f64 * eased).trunc()));
    }
    Ok(if frame > keys.last().unwrap().frame { Some(keys.last().unwrap().value as f64) } else { None })
}

fn valid_animated_parent(part_index: usize, parent_index: i64, parts: &[PartState]) -> bool {
    if parent_index < 0 || parent_index >= parts.len() as i64 || parent_index == part_index as i64 { return false; }
    let mut visited = HashSet::from([part_index as i64]);
    let mut current = parent_index;
    while current >= 0 {
        if !visited.insert(current) { return false; }
        current = parts.get(current as usize).map(|part| part.parent).unwrap_or(-1);
    }
    true
}

fn apply_property(parts: &mut [PartState], part_index: usize, property: i64, value: f64, model: &MaModel) -> Result<()> {
    let base = &model.parts[part_index];
    let part_count = parts.len() as i64;
    if property == 0 {
        let parent_index = value.trunc() as i64;
        let valid = valid_animated_parent(part_index, parent_index, parts);
        parts[part_index].parent = if valid { parent_index } else if part_index == 0 { -1 } else { 0 };
        return Ok(());
    }
    let part = &mut parts[part_index];
    match property {
        1 => part.id = value.trunc() as i64,
        2 => part.image_index = value.trunc() as i64,
        3 => {
            part.z_index = value.trunc() as i64;
            part.z_order = part.z_index * part_count + part_index as i64;
        }
        4 => part.x = base.x as f64 + value,
        5 => part.y = base.y as f64 + value,
        6 => part.pivot_x = base.pivot_x as f64 + value,
        7 => part.pivot_y = base.pivot_y as f64 + value,
        8 => {
            part.scale_factor_x = value;
            part.scale_factor_y = value;
            part.scale_x = native_divide(base.scale_x as f64 * value, model.scale_unit as f64)?;
            part.scale_y = native_divide(base.scale_y as f64 * value, model.scale_unit as f64)?;
        }
        9 => {
            part.scale_factor_x = value;
            part.scale_x = native_divide(base.scale_x as f64 * value, model.scale_unit as f64)?;
        }
        10 => {
            part.scale_factor_y = value;
            part.scale_y = native_divide(base.scale_y as f64 * value, model.scale_unit as f64)?;
        }
        11 => part.angle = base.angle as f64 + value,
        12 => {
            part.opacity_factor = value;
            part.opacity = native_divide(base.opacity as f64 * value, model.opacity_unit as f64)?;
        }
        13 => part.flip_x = if value == 0.0 { 1 } else { -1 },
        14 => part.flip_y = if value == 0.0 { 1 } else { -1 },
        _ => {}
    }
    Ok(())
}

fn validate_animated_parents(parts: &mut [PartState]) {
    for index in 0..parts.len() {
        if parts[index].parent < -1 || parts[index].parent >= parts.len() as i64 || parts[index].parent == index as i64 {
            parts[index].parent = if index == 0 { -1 } else { 0 };
        }
        let mut visited = HashSet::from([index as i64]);
        let mut parent_index = parts[index].parent;
        while parent_index >= 0 {
            if !visited.insert(parent_index) {
                parts[index].parent = if index == 0 { -1 } else { 0 };
                break;
            }
            parent_index = parts.get(parent_index as usize).map(|part| part.parent).unwrap_or(-1);
        }
    }
}

fn evaluate_integer_pose(project: &MotionProject, motion: &MaAnim, frame: i64) -> Result<Vec<PartState>> {
    let mut parts: Vec<PartState> = project.model.parts.iter()
        .map(|part| reset_part(part, project.model.parts.len(), &project.model))
        .collect();
    for track in &motion.tracks {
        let track_frame = resolve_track_frame(track, frame, motion.max_frame);
        if let Some(value) = evaluate_track(track, track_frame)? {
            apply_property(&mut parts, track.part_index as usize, track.property, value, &project.model)?;
        }
    }
    validate_animated_parents(&mut parts);
    Ok(parts)
}

fn interpolate_number(current: f64, next: f64, progress: f64) -> f64 {
    current + (next - current) * progress
}

fn positive_modulo_f64(value: f64, divisor: f64) -> f64 {
    if divisor == 0.0 { 0.0 } else { ((value % divisor) + divisor) % divisor }
}

fn interpolate_angle(current: f64, next: f64, progress: f64, angle_unit: f64) -> f64 {
    let mut difference = next - current;
    if angle_unit > 0.0 {
        difference = positive_modulo_f64(difference + angle_unit / 2.0, angle_unit) - angle_unit / 2.0;
        if difference == -angle_unit / 2.0 && next > current { difference = angle_unit / 2.0; }
    }
    current + difference * progress
}

fn interpolate_pose(current: Vec<PartState>, next: &[PartState], progress: f64, model: &MaModel) -> Vec<PartState> {
    current.into_iter().enumerate().map(|(index, mut part)| {
        let target = &next[index];
        part.matrix = None;
        part.vertices = None;
        if part.parent != target.parent || part.flip_x != target.flip_x || part.flip_y != target.flip_y {
            return part;
        }
        part.x = interpolate_number(part.x, target.x, progress);
        part.y = interpolate_number(part.y, target.y, progress);
        part.pivot_x = interpolate_number(part.pivot_x, target.pivot_x, progress);
        part.pivot_y = interpolate_number(part.pivot_y, target.pivot_y, progress);
        part.scale_factor_x = interpolate_number(part.scale_factor_x, target.scale_factor_x, progress);
        part.scale_factor_y = interpolate_number(part.scale_factor_y, target.scale_factor_y, progress);
        let visibility_switch = (part.opacity_factor == 0.0 && target.opacity_factor == model.opacity_unit as f64)
            || (part.opacity_factor == model.opacity_unit as f64 && target.opacity_factor == 0.0);
        if !visibility_switch {
            part.opacity_factor = interpolate_number(part.opacity_factor, target.opacity_factor, progress);
        }
        part.angle = interpolate_angle(part.angle, target.angle, progress, model.angle_unit as f64);
        let base = &model.parts[part.base_index];
        part.scale_x = base.scale_x as f64 * part.scale_factor_x / model.scale_unit as f64;
        part.scale_y = base.scale_y as f64 * part.scale_factor_y / model.scale_unit as f64;
        part.opacity = base.opacity as f64 * part.opacity_factor / model.opacity_unit as f64;
        part
    }).collect()
}

fn fround(value: f64) -> f64 { (value as f32) as f64 }

fn create_translation_matrix(x: f64, y: f64) -> [f64; 6] {
    [1.0, 0.0, fround(x), 0.0, 1.0, fround(y)]
}

fn translate_matrix(matrix: [f64; 6], x: f64, y: f64) -> [f64; 6] {
    let mut result = matrix;
    result[2] = fround(matrix[2] + fround(matrix[1] * y) + fround(matrix[0] * x));
    result[5] = fround(matrix[5] + fround(matrix[4] * y) + fround(matrix[3] * x));
    result
}

fn rotate_matrix(matrix: [f64; 6], angle: f64) -> [f64; 6] {
    if angle == 0.0 { return matrix; }
    let sine = fround(fround(angle).sin());
    let cosine = fround(fround(angle).cos());
    let [a, b, tx, c, d, ty] = matrix;
    [
        fround(fround(sine * b) + fround(a * cosine)),
        fround(fround(cosine * b) - fround(a * sine)),
        tx,
        fround(fround(sine * d) + fround(c * cosine)),
        fround(fround(cosine * d) - fround(c * sine)),
        ty,
    ]
}

fn transform_point(matrix: [f64; 6], x: f64, y: f64, interpolated: bool) -> [f64; 2] {
    let px = fround(matrix[2] + fround(matrix[1] * y) + fround(matrix[0] * x));
    let py = fround(matrix[5] + fround(matrix[4] * y) + fround(matrix[3] * x));
    if interpolated { [px, py] } else { [px.trunc(), py.trunc()] }
}

fn divide(value: f64, denominator: f64, interpolated: bool) -> Result<f64> {
    if interpolated {
        if denominator == 0.0 { Err(invalid("0では除算できません")) } else { Ok(value / denominator) }
    } else {
        native_divide(value, denominator)
    }
}

fn calculate_part_transform(index: usize, parts: &mut [PartState], project: &MotionProject, facing: i32, interpolated: bool) -> Result<()> {
    let parent = if parts[index].parent >= 0 { Some(parts[parts[index].parent as usize].clone()) } else { None };
    let base = &project.model.parts[index];
    let scale_unit = project.model.scale_unit as f64;
    let opacity_unit = project.model.opacity_unit as f64;
    let part = &mut parts[index];
    part.uses_interpolated_math = interpolated;
    if let Some(parent) = parent {
        part.native_scale_x = divide(divide(base.scale_x as f64 * part.scale_factor_x * parent.native_scale_x, scale_unit, interpolated)?, scale_unit, interpolated)?;
        part.native_scale_y = divide(divide(base.scale_y as f64 * part.scale_factor_y * parent.native_scale_y, scale_unit, interpolated)?, scale_unit, interpolated)?;
        part.native_opacity = divide(divide(base.opacity as f64 * part.opacity_factor * parent.native_opacity, opacity_unit, interpolated)?, opacity_unit, interpolated)?;
        part.native_flip_x = (part.flip_x < 0) != parent.native_flip_x;
        part.native_flip_y = (part.flip_y < 0) != parent.native_flip_y;
        part.matrix = Some(translate_matrix(
            parent.matrix.unwrap(),
            divide(parent.native_scale_x * part.x, scale_unit, interpolated)?,
            divide(parent.native_scale_y * part.y, scale_unit, interpolated)?,
        ));
    } else {
        part.native_scale_x = divide(base.scale_x as f64 * part.scale_factor_x, scale_unit, interpolated)?;
        part.native_scale_y = divide(base.scale_y as f64 * part.scale_factor_y, scale_unit, interpolated)?;
        part.native_opacity = divide(base.opacity as f64 * part.opacity_factor, opacity_unit, interpolated)?;
        if facing < 0 { part.native_scale_x = -part.native_scale_x; }
        part.native_flip_x = part.flip_x < 0;
        part.native_flip_y = part.flip_y < 0;
        part.matrix = Some(create_translation_matrix(part.x, part.y));
    }
    if part.flip_x < 0 { part.native_scale_x = -part.native_scale_x; }
    if part.flip_y < 0 { part.native_scale_y = -part.native_scale_y; }
    let mut angle = part.angle * TWO_PI / project.model.angle_unit as f64;
    if facing < 0 { angle = -angle; }
    if part.native_flip_x != part.native_flip_y { angle = -angle; }
    part.matrix = Some(rotate_matrix(part.matrix.unwrap(), angle));
    let Some(cut) = project.imgcut.cuts.get(part.image_index.max(0) as usize) else { return Ok(()) };
    if part.id < 0 || part.image_index < 0 { return Ok(()); }
    let left = divide(-part.native_scale_x * part.pivot_x, scale_unit, interpolated)?;
    let top = divide(-part.native_scale_y * part.pivot_y, scale_unit, interpolated)?;
    let right = left + divide(part.native_scale_x * cut.width as f64, scale_unit, interpolated)?;
    let bottom = top + divide(part.native_scale_y * cut.height as f64, scale_unit, interpolated)?;
    let matrix = part.matrix.unwrap();
    part.vertices = Some([
        transform_point(matrix, left, top, interpolated),
        transform_point(matrix, left, bottom, interpolated),
        transform_point(matrix, right, bottom, interpolated),
        transform_point(matrix, right, top, interpolated),
    ]);
    Ok(())
}

fn calculate_transforms(parts: &mut [PartState], project: &MotionProject, facing: i32, interpolated: bool) -> Result<()> {
    let mut pending: Vec<usize> = (0..parts.len()).collect();
    let mut completed = HashSet::from([-1_i64]);
    while !pending.is_empty() {
        let mut progressed = false;
        let mut cursor = 0;
        while cursor < pending.len() {
            let index = pending[cursor];
            if !completed.contains(&parts[index].parent) {
                cursor += 1;
                continue;
            }
            calculate_part_transform(index, parts, project, facing, interpolated)?;
            pending.remove(cursor);
            completed.insert(index as i64);
            progressed = true;
        }
        if !progressed { return Err(invalid("アニメーション後の親関係を解決できません")); }
    }
    Ok(())
}

fn evaluate_motion(project: &MotionProject, motion_key: &str, frame: f64, facing: i32, interpolate: bool) -> Result<Vec<PartState>> {
    let motion = project.motions.get(motion_key).ok_or_else(|| invalid(format!("不明なモーションです: {motion_key}")))?;
    let frame_count = motion.max_frame + 1;
    let normalized = positive_modulo_f64(frame, frame_count as f64);
    let current_frame = normalized.floor() as i64;
    let progress = normalized - current_frame as f64;
    let can_interpolate = interpolate && progress > f64::EPSILON && current_frame < motion.max_frame;
    let mut parts = evaluate_integer_pose(project, motion, current_frame)?;
    if can_interpolate {
        let next = evaluate_integer_pose(project, motion, current_frame + 1)?;
        parts = interpolate_pose(parts, &next, progress, &project.model);
    }
    calculate_transforms(&mut parts, project, facing, interpolate)?;
    parts.sort_by(|left, right| left.z_order.cmp(&right.z_order));
    Ok(parts)
}

fn calculate_model_anchor(parts: &[PartState], model: &MaModel) -> Result<[f64; 2]> {
    let Some(config) = model.configs.first().map(|value| &value.values) else { return Ok([0.0, 0.0]) };
    let target_index = if config[0] < 0 { 0 } else { config[0] as usize };
    let Some(target) = parts.iter().find(|part| part.base_index == target_index) else { return Ok([0.0, 0.0]) };
    let Some(matrix) = target.matrix else { return Ok([0.0, 0.0]) };
    let local_x = divide((config[2] as f64 - target.pivot_x) * target.native_scale_x, model.scale_unit as f64, target.uses_interpolated_math)?;
    let local_y = divide((config[3] as f64 - target.pivot_y) * target.native_scale_y, model.scale_unit as f64, target.uses_interpolated_math)?;
    Ok(transform_point(matrix, local_x, local_y, target.uses_interpolated_math))
}

fn build_draw_packets(project: &MotionProject, motion_key: &str, frame: f64, options: Option<DrawOptions>) -> Result<Vec<DrawPacket>> {
    let options = options.unwrap_or(DrawOptions {
        origin_x: None, origin_y: None, scale: None, facing: None, alpha: None,
        use_model_anchor: None, interpolate: None,
    });
    let origin_x = options.origin_x.unwrap_or(0.0);
    let origin_y = options.origin_y.unwrap_or(0.0);
    let scale = options.scale.unwrap_or(1.0);
    let facing = options.facing.unwrap_or(1);
    let alpha = options.alpha.unwrap_or(1.0);
    let use_anchor = options.use_model_anchor.unwrap_or(true);
    let interpolate = options.interpolate.unwrap_or(false);
    let parts = evaluate_motion(project, motion_key, frame, facing, interpolate)?;
    let anchor = if use_anchor { calculate_model_anchor(&parts, &project.model)? } else { [0.0, 0.0] };
    if !(project.image_width > 0.0 && project.image_height > 0.0) {
        return Err(invalid("スプライトシートの寸法を取得できません"));
    }
    let mut blend_mode = 0;
    let mut packets = Vec::new();
    for part in parts {
        let Some(vertices) = part.vertices else { continue };
        let Some(cut) = project.imgcut.cuts.get(part.image_index as usize) else { continue };
        if (0..4).contains(&part.glow) { blend_mode = part.glow as i32; }
        let opacity_byte = if part.uses_interpolated_math {
            part.native_opacity * 255.0 / project.model.opacity_unit as f64
        } else {
            native_divide(part.native_opacity * 255.0, project.model.opacity_unit as f64)?
        };
        if opacity_byte == 0.0 { continue; }
        let mut positions = Vec::with_capacity(8);
        for vertex in vertices {
            positions.push(origin_x + (vertex[0] - anchor[0]) * scale);
            positions.push(origin_y + (vertex[1] - anchor[1]) * scale);
        }
        let left = cut.x as f64 / project.image_width;
        let top = cut.y as f64 / project.image_height;
        let right = (cut.x + cut.width) as f64 / project.image_width;
        let bottom = (cut.y + cut.height) as f64 / project.image_height;
        packets.push(DrawPacket {
            part_index: part.base_index as i32,
            blend_mode,
            opacity: (opacity_byte / 255.0 * alpha).clamp(0.0, 1.0),
            positions,
            uvs: vec![left, top, left, bottom, right, bottom, right, top],
        });
    }
    Ok(packets)
}

fn validate_project(project: &MotionProject) -> Result<()> {
    for (key, motion) in &project.motions {
        for track in &motion.tracks {
            if track.part_index < 0 || track.part_index >= project.model.parts.len() as i64 {
                return Err(invalid(format!("{key}: 存在しないパーツ #{} を参照しています", track.part_index)));
            }
            if track.property == 2 {
                for animation_key in &track.keys {
                    if animation_key.value < 0 || animation_key.value >= project.imgcut.cuts.len() as i64 {
                        return Err(invalid(format!("{key}: 存在しない分割画像 #{} を参照しています", animation_key.value)));
                    }
                }
            }
        }
    }
    Ok(())
}

#[napi]
impl MotionCoreProject {
    #[napi(constructor)]
    pub fn new(
        imgcut_text: String,
        model_text: String,
        motion_sources: Vec<MotionSource>,
        image_width: f64,
        image_height: f64,
    ) -> Result<Self> {
        let motions = motion_sources.into_iter()
            .map(|source| parse_ma_anim(&source.text).map(|motion| (source.key, motion)))
            .collect::<Result<HashMap<_, _>>>()?;
        let project = MotionProject {
            imgcut: parse_img_cut(&imgcut_text)?,
            model: parse_ma_model(&model_text)?,
            motions,
            image_width,
            image_height,
        };
        validate_project(&project)?;
        Ok(Self { project })
    }

    #[napi]
    pub fn get_max_frame(&self, motion_key: String) -> Result<i32> {
        let motion = self.project.motions.get(&motion_key)
            .ok_or_else(|| invalid(format!("不明なモーションです: {motion_key}")))?;
        i32::try_from(motion.max_frame).map_err(|_| invalid("最終フレームが範囲外です"))
    }

    #[napi]
    pub fn get_imgcut_json(&self) -> Result<String> {
        serde_json::to_string(&self.project.imgcut).map_err(|error| invalid(error.to_string()))
    }

    #[napi]
    pub fn build_draw_packets(&self, motion_key: String, frame: f64, options: Option<DrawOptions>) -> Result<Vec<DrawPacket>> {
        build_draw_packets(&self.project, &motion_key, frame, options)
    }

    #[napi]
    pub fn build_frame_set(&self, motion_keys: Vec<String>, frames: Vec<i32>) -> Result<CompactFrameSet> {
        if motion_keys.len() != frames.len() {
            return Err(invalid("モーションとフレームの件数が一致しません"));
        }
        let mut data = Vec::new();
        let mut offsets = Vec::with_capacity(frames.len());
        let mut packet_counts = Vec::with_capacity(frames.len());
        for (motion_key, frame) in motion_keys.iter().zip(frames) {
            let packets = build_draw_packets(&self.project, motion_key, frame as f64, None)?;
            offsets.push(u32::try_from(data.len()).map_err(|_| invalid("compact packetが大きすぎます"))?);
            packet_counts.push(u32::try_from(packets.len()).map_err(|_| invalid("packet数が多すぎます"))?);
            for packet in packets {
                data.extend_from_slice(&packet.part_index.to_le_bytes());
                data.extend_from_slice(&packet.blend_mode.to_le_bytes());
                data.extend_from_slice(&packet.opacity.to_le_bytes());
                for value in packet.positions { data.extend_from_slice(&value.to_le_bytes()); }
                for value in packet.uvs { data.extend_from_slice(&value.to_le_bytes()); }
            }
        }
        Ok(CompactFrameSet { data: data.into(), offsets, packet_counts })
    }
}

#[napi]
pub fn parse_img_cut_json(text: String) -> Result<String> {
    serde_json::to_string(&parse_img_cut(&text)?).map_err(|error| invalid(error.to_string()))
}

#[napi]
pub fn parse_ma_model_json(text: String) -> Result<String> {
    serde_json::to_string(&parse_ma_model(&text)?).map_err(|error| invalid(error.to_string()))
}

#[napi]
pub fn parse_ma_anim_json(text: String) -> Result<String> {
    serde_json::to_string(&parse_ma_anim(&text)?).map_err(|error| invalid(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_division_rounds_toward_zero() {
        assert_eq!(native_divide(7.0, 3.0).unwrap(), 2.0);
        assert_eq!(native_divide(-7.0, 3.0).unwrap(), -2.0);
    }

    #[test]
    fn parses_and_evaluates_a_small_project() {
        let project = MotionProject {
            imgcut: parse_img_cut("[imgcut]\n1\nsprite.png\n1\n0,0,32,32\n").unwrap(),
            model: parse_ma_model("[mamodel]\n1\n1\n-1,0,0,0,0,0,0,0,1000,1000,0,255,0\n1000,3600,255\n").unwrap(),
            motions: HashMap::from([(
                "move".to_owned(),
                parse_ma_anim("[modelanim:animation]\n1\n1\n0,4,1,0,0\n2\n0,0,0,0\n1,10,0,0\n").unwrap(),
            )]),
            image_width: 32.0,
            image_height: 32.0,
        };
        let packets = build_draw_packets(&project, "move", 1.0, None).unwrap();
        assert_eq!(packets.len(), 1);
        assert_eq!(packets[0].positions[0], 10.0);
    }
}
