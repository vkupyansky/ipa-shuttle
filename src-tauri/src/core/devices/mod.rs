use std::collections::HashMap;

use tauri::AppHandle;

use crate::{
    engine,
    errors::AppError,
    logging,
    models::{Device, DeviceInfo, DeviceTrustStatus},
};

#[tauri::command]
pub async fn detect_devices(app: AppHandle) -> Result<Vec<Device>, AppError> {
    tauri::async_runtime::spawn_blocking(move || detect_devices_sync(&app))
        .await
        .map_err(|err| AppError::storage(format!("Failed to join device detection: {err}")))?
}

#[tauri::command]
pub async fn get_device_info(
    app: AppHandle,
    device_id: Option<String>,
) -> Result<DeviceInfo, AppError> {
    tauri::async_runtime::spawn_blocking(move || get_device_info_sync(&app, device_id.as_deref()))
        .await
        .map_err(|err| AppError::storage(format!("Failed to join device info lookup: {err}")))?
}

pub fn detect_devices_sync(app: &AppHandle) -> Result<Vec<Device>, AppError> {
    engine::ensure_engines(app)?;
    logging::log_info("iPhone", "Checking connected iPhones")?;
    let output = engine::run_engine(
        app,
        "idevice_id",
        &["-l".to_string()],
        &["-l".to_string()],
        "Checked connected iPhones",
    )?;

    if !output.success {
        if let Some(error) = engine::classify_device_error(&output) {
            return Err(error);
        }
        return Err(AppError::process_failed(
            "Could not detect connected iPhones.",
            engine::combined_output(&output),
        ));
    }

    let udids = output
        .stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();

    let mut devices = Vec::with_capacity(udids.len());
    for udid in udids {
        match get_device_info_sync(app, Some(&udid)) {
            Ok(info) => devices.push(Device {
                udid: info.udid,
                name: info.name,
                model: info.model,
                ios_version: info.ios_version,
                battery_percent: info.battery_percent,
                connected: true,
                trust_status: info.trust_status,
            }),
            Err(error) if error.code == "DEVICE_NOT_TRUSTED" => devices.push(Device {
                udid,
                name: None,
                model: None,
                ios_version: None,
                battery_percent: None,
                connected: true,
                trust_status: DeviceTrustStatus::NotTrusted,
            }),
            Err(error) => return Err(error),
        }
    }

    if devices.is_empty() {
        logging::log_warning("iPhone", "No iPhone connected", None)?;
    } else {
        for device in &devices {
            let name = device.name.as_deref().unwrap_or("iPhone");
            logging::log_success("iPhone", format!("iPhone detected: {name}"), None)?;
        }
    }

    Ok(devices)
}

pub fn get_device_info_sync(
    app: &AppHandle,
    device_id: Option<&str>,
) -> Result<DeviceInfo, AppError> {
    engine::ensure_engines(app)?;

    let mut args = Vec::new();
    if let Some(udid) = device_id {
        args.push("-u".to_string());
        args.push(udid.to_string());
    }

    let output = engine::run_engine(
        app,
        "ideviceinfo",
        &args,
        &args,
        "Read iPhone device information",
    )?;

    if !output.success {
        if let Some(error) = engine::classify_device_error(&output) {
            return Err(error);
        }
        return Err(AppError::process_failed(
            "Could not read iPhone information.",
            engine::combined_output(&output),
        ));
    }

    let fields = parse_ideviceinfo(&output.stdout);
    let udid = fields
        .get("UniqueDeviceID")
        .cloned()
        .or_else(|| device_id.map(ToOwned::to_owned))
        .ok_or_else(|| AppError::process_failed("Could not read iPhone UDID.", &output.stdout))?;

    let battery_percent = read_battery_percent(app, device_id);

    Ok(DeviceInfo {
        udid,
        name: fields.get("DeviceName").cloned(),
        model: fields
            .get("ProductType")
            .map(|product_type| product_type_to_model_name(product_type)),
        ios_version: fields.get("ProductVersion").cloned(),
        battery_percent,
        connected: true,
        trust_status: DeviceTrustStatus::Connected,
    })
}

fn read_battery_percent(app: &AppHandle, device_id: Option<&str>) -> Option<u8> {
    let mut args = Vec::new();
    if let Some(udid) = device_id {
        args.push("-u".to_string());
        args.push(udid.to_string());
    }
    args.push("-q".to_string());
    args.push("com.apple.mobile.battery".to_string());

    let output = engine::run_engine_with_env_quiet(app, "ideviceinfo", &args, &[]).ok()?;
    if !output.success {
        return None;
    }
    parse_battery_percent(&output.stdout)
}

fn parse_battery_percent(stdout: &str) -> Option<u8> {
    parse_ideviceinfo(stdout)
        .get("BatteryCurrentCapacity")
        .and_then(|value| value.parse::<u8>().ok())
        .filter(|value| *value <= 100)
}

fn parse_ideviceinfo(stdout: &str) -> HashMap<String, String> {
    stdout
        .lines()
        .filter_map(|line| line.split_once(": "))
        .map(|(key, value)| (key.trim().to_string(), value.trim().to_string()))
        .collect()
}

fn product_type_to_model_name(product_type: &str) -> String {
    match product_type {
        "iPhone10,1" | "iPhone10,4" => "iPhone 8",
        "iPhone10,2" | "iPhone10,5" => "iPhone 8 Plus",
        "iPhone10,3" | "iPhone10,6" => "iPhone X",
        "iPhone11,2" => "iPhone XS",
        "iPhone11,4" | "iPhone11,6" => "iPhone XS Max",
        "iPhone11,8" => "iPhone XR",
        "iPhone12,1" => "iPhone 11",
        "iPhone12,3" => "iPhone 11 Pro",
        "iPhone12,5" => "iPhone 11 Pro Max",
        "iPhone12,8" => "iPhone SE (2nd generation)",
        "iPhone13,1" => "iPhone 12 mini",
        "iPhone13,2" => "iPhone 12",
        "iPhone13,3" => "iPhone 12 Pro",
        "iPhone13,4" => "iPhone 12 Pro Max",
        "iPhone14,2" => "iPhone 13 Pro",
        "iPhone14,3" => "iPhone 13 Pro Max",
        "iPhone14,4" => "iPhone 13 mini",
        "iPhone14,5" => "iPhone 13",
        "iPhone14,6" => "iPhone SE (3rd generation)",
        "iPhone14,7" => "iPhone 14",
        "iPhone14,8" => "iPhone 14 Plus",
        "iPhone15,2" => "iPhone 14 Pro",
        "iPhone15,3" => "iPhone 14 Pro Max",
        "iPhone15,4" => "iPhone 15",
        "iPhone15,5" => "iPhone 15 Plus",
        "iPhone16,1" => "iPhone 15 Pro",
        "iPhone16,2" => "iPhone 15 Pro Max",
        "iPhone17,1" => "iPhone 16 Pro",
        "iPhone17,2" => "iPhone 16 Pro Max",
        "iPhone17,3" => "iPhone 16",
        "iPhone17,4" => "iPhone 16 Plus",
        "iPhone17,5" => "iPhone 16e",
        value if value.starts_with("iPhone") => "iPhone",
        _ => "iPhone",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ideviceinfo_key_value_output() {
        let fields = parse_ideviceinfo(
            "DeviceName: Test iPhone\nProductVersion: 18.5\nUniqueDeviceID: abc123\nBatteryCurrentCapacity: 87\n",
        );

        assert_eq!(
            fields.get("DeviceName").map(String::as_str),
            Some("Test iPhone")
        );
        assert_eq!(
            fields.get("ProductVersion").map(String::as_str),
            Some("18.5")
        );
        assert_eq!(
            fields.get("UniqueDeviceID").map(String::as_str),
            Some("abc123")
        );
        assert_eq!(
            fields.get("BatteryCurrentCapacity").map(String::as_str),
            Some("87")
        );
    }

    #[test]
    fn maps_known_product_type_to_marketing_name() {
        assert_eq!(
            product_type_to_model_name("iPhone15,3"),
            "iPhone 14 Pro Max"
        );
        assert_eq!(product_type_to_model_name("iPhone99,9"), "iPhone");
    }

    #[test]
    fn parses_available_and_invalid_battery_percentages() {
        assert_eq!(
            parse_battery_percent("BatteryCurrentCapacity: 83\n"),
            Some(83)
        );
        assert_eq!(parse_battery_percent("BatteryCurrentCapacity: 101\n"), None);
        assert_eq!(parse_battery_percent("BatteryIsCharging: true\n"), None);
    }
}
