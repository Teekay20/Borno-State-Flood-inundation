// Define the Area of Interest (AOI) for Borno using actual coordinates
var AOI = ee.Geometry.Polygon(
    [[[11.638489403702787, 10.005804470079187],
      [12.033997216202787, 9.930061065881734],
      [12.693176903702787, 10.405866019353805],
      [13.066712059952787, 10.211304309796578],
      [13.795263762228544, 10.924098587811825],
      [14.937841887228544, 11.592139858692834],
      [14.479696283599587, 12.877269913047702],
      [13.479940424224587, 13.903270701339409],
      [12.458211908599587, 13.358751975084983],
      [12.117635736724587, 11.879306758123136],
      [11.359579096099587, 10.305321382127937],
      [11.638489403702787, 10.005804470079187]]],    
    'EPSG:4326' // CRS for latitude-longitude
  );
  
  // Center the map on the AOI and add AOI layer
  Map.centerObject(AOI, 10);
  Map.addLayer(AOI, {color: 'blue'}, 'Borno AOI');
  Map.addLayer(ROI);
  
  // Load the Sentinel-1 ImageCollection with necessary filters
  var collection = ee.ImageCollection('COPERNICUS/S1_GRD')
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.or(
      ee.Filter.eq('orbitProperties_pass', 'DESCENDING'),
      ee.Filter.eq('orbitProperties_pass', 'ASCENDING')
    ))
    .filterBounds(AOI);
  
  // Define the date ranges for before and after the flood
  var beforeStart = '2024-08-01';
  var beforeEnd = '2024-09-01';
  var afterStart = '2024-09-09';
  var afterEnd = '2024-10-20';
  
  // Filter the collection for before and after flood images
  var before = collection.filter(ee.Filter.date(beforeStart, beforeEnd));
  var after = collection.filter(ee.Filter.date(afterStart, afterEnd));
  
  // Mosaic the images and clip to AOI
  var before_image = before.select('VH').mosaic().clip(AOI);
  var after_image = after.select('VH').mosaic().clip(AOI);
  
  // Apply a median filter for noise reduction
  var kernelSize = 3; // Adjust the kernel size as needed
  var before_filtered = before_image.focal_median(kernelSize);
  var after_filtered = after_image.focal_median(kernelSize);
  
  // Define flood and refined water detection thresholds
  var floodThreshold = -15;       // Flood threshold remains the same
  var waterThreshold = -20;       // Lower threshold for water to reduce water body detection
  
  // Flood detection: Temporary water where backscatter drops post-flood
  var flood = before_filtered.gt(floodThreshold).and(after_filtered.lt(floodThreshold));
  var flood_mask = flood.updateMask(flood.eq(1));
  
  // Apply morphological dilation to the flood mask for smoother inundation
  var dilatedFloodMask = flood_mask.focal_max(3, 'circle', 'pixels');
  
  // Water detection: Persistent water bodies with more selective threshold
  var water = before_filtered.lt(waterThreshold).and(after_filtered.lt(waterThreshold));
  var water_mask = water.updateMask(water.eq(1));
  
  // Visualize the flood inundation and water bodies
  Map.addLayer(dilatedFloodMask, {palette: ['green']}, 'Flood Inundation');
  Map.addLayer(water_mask, {palette: ['blue']}, 'Reduced Water Bodies');
  
  // Visualize the before and after images
  Map.addLayer(before_filtered, {min: -25, max: 0}, 'Before Filtered');
  Map.addLayer(after_filtered, {min: -25, max: 0}, 'After Filtered');
  
  // Calculate area of AOI (optional)
  print('Total AOI Area (Ha)', AOI.area().divide(10000));
  
  // Calculate flood area in hectares with increased scale
  var flood_stats = dilatedFloodMask.multiply(ee.Image.pixelArea()).reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: AOI,
    scale: 50,
    maxPixels: 1e13
  });
  
  // Print the flood stats
  print('Flood Stats', flood_stats);
  
  // Get the 'VH' band value from flood_stats and handle NaN values
  var flood_sum = flood_stats.get('VH');
  var flood_area = ee.Algorithms.If(
    flood_sum === null || flood_sum === undefined, 
    ee.Number(0),
    ee.Number(flood_sum).divide(10000).round()
  );
  print('Flooded Area (Ha)', flood_area);
  
  // Load ESA Land Cover dataset for agricultural area analysis (assuming cropland value = 40)
  var landCover = ee.Image("ESA/WorldCover/v100/2020");
  var agriculturalAreas = landCover.eq(40).selfMask();
  
  // Mask the flood areas to identify affected agricultural areas
  var affectedAgriculturalAreas = dilatedFloodMask.updateMask(agriculturalAreas);
  
  // Apply morphological dilation to the affected agricultural areas for better shape representation
  var dilatedAgriculturalAreas = affectedAgriculturalAreas.focal_max(3, 'circle', 'pixels');
  
  // Visualize the affected agricultural areas
  Map.addLayer(dilatedAgriculturalAreas, {palette: ['red']}, 'Affected Agricultural Areas');
  
  // Calculate the affected agricultural area in hectares
  var agricultural_stats = dilatedAgriculturalAreas.multiply(ee.Image.pixelArea()).reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: AOI,
    scale: 50,
    maxPixels: 1e13
  });
  
  // Check if there are keys and get the first available one
  var agricultural_keys = agricultural_stats.keys();
  print('Keys in Agricultural Stats:', agricultural_keys);
  
  // Access the first available key
  var first_key = agricultural_keys.get(0);
  
  // Retrieve the agricultural area using the first key and handle NaN values
  var agricultural_sum = agricultural_stats.get(first_key);
  var affected_agricultural_area = ee.Algorithms.If(
    agricultural_sum === null || agricultural_sum === undefined, 
    ee.Number(0),
    ee.Number(agricultural_sum).divide(10000).round()
  );
  print('Affected Agricultural Area (Ha)', affected_agricultural_area);
  
  // Load Google Open Buildings dataset and filter for buildings in AOI
  var openBuildings = ee.FeatureCollection("GOOGLE/Research/open-buildings/v3/polygons")
    .filterBounds(AOI);
  
  // Mask the flood-affected buildings by intersecting with the flood mask
  var affectedBuildings = openBuildings.filterBounds(flood_mask.geometry());
  var affectedBuildingsImage = ee.Image().int().paint(affectedBuildings, 1).clip(AOI);
  
  // Apply morphological dilation for better visualization
  var dilatedAffectedBuildings = affectedBuildingsImage.focal_max(3, 'circle', 'pixels');
  
  // Visualize the affected buildings
  Map.addLayer(dilatedAffectedBuildings, {palette: 'purple'}, 'Affected Buildings');
  
  // Calculate the affected building area in hectares
  var buildingStats = dilatedAffectedBuildings.multiply(ee.Image.pixelArea()).reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: AOI,
    scale: 30, // Set appropriate scale
    maxPixels: 1e13
  });
  
  // Retrieve building area with error handling
  var affectedBuildingArea = ee.Algorithms.If(
    buildingStats.get('constant') === null,
    ee.Number(0),
    ee.Number(buildingStats.get('constant')).divide(10000).round()
  );
  print('Affected Buildings Area (Ha):', affectedBuildingArea);
  
  // Define ROI by clipping the affected areas to it
  var affectedBuildingsClipped = dilatedAffectedBuildings.clip(ROI);
  var affectedAgriculturalAreasClipped = dilatedAgriculturalAreas.clip(ROI);
  var waterMaskClipped = water_mask.clip(ROI);
  var floodInundationClipped = dilatedFloodMask.clip(ROI);
  
  // Add each clipped layer to the map for visualization
  Map.addLayer(affectedBuildingsClipped, {palette: 'purple'}, 'Clipped Affected Buildings');
  Map.addLayer(affectedAgriculturalAreasClipped, {palette: 'red'}, 'Clipped Affected Agricultural Areas');
  Map.addLayer(waterMaskClipped, {palette: 'blue'}, 'Clipped Water Bodies');
  Map.addLayer(floodInundationClipped, {palette: 'green'}, 'Clipped Flood Inundation');
  
  // Calculate area for each affected region within the clipped ROI
  var clippedBuildingStats = affectedBuildingsClipped.multiply(ee.Image.pixelArea()).reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: ROI,
    scale: 100,
    maxPixels: 1e13
  });
  
  var clippedAgriculturalStats = affectedAgriculturalAreasClipped.multiply(ee.Image.pixelArea()).reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: ROI,
    scale: 100,
    maxPixels: 1e13
  });
  
  var clippedWaterStats = waterMaskClipped.multiply(ee.Image.pixelArea()).reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: ROI,
    scale: 100,
    maxPixels: 1e13
  });
  
  var clippedFloodStats = floodInundationClipped.multiply(ee.Image.pixelArea()).reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: ROI,
    scale: 100,
    maxPixels: 1e13
  });
  
  // Access each area's summed value using the correct band names
  var affectedBuildingAreaClipped = ee.Algorithms.If(
    clippedBuildingStats.get(clippedBuildingStats.keys().get(0)) === null,
    ee.Number(0),
    ee.Number(clippedBuildingStats.get(clippedBuildingStats.keys().get(0))).divide(10000).round()
  );
  var affectedAgriculturalAreaClipped = ee.Algorithms.If(
    clippedAgriculturalStats.get(clippedAgriculturalStats.keys().get(0)) === null,
    ee.Number(0),
    ee.Number(clippedAgriculturalStats.get(clippedAgriculturalStats.keys().get(0))).divide(10000).round()
  );
  var waterAreaClipped = ee.Algorithms.If(
    clippedWaterStats.get(clippedWaterStats.keys().get(0)) === null,
    ee.Number(0),
    ee.Number(clippedWaterStats.get(clippedWaterStats.keys().get(0))).divide(10000).round()
  );
  var floodAreaClipped = ee.Algorithms.If(
    clippedFloodStats.get(clippedFloodStats.keys().get(0)) === null,
    ee.Number(0),
    ee.Number(clippedFloodStats.get(clippedFloodStats.keys().get(0))).divide(10000).round()
  );
  
  // Print clipped areas
  print('Clipped Affected Buildings Area (Ha):', affectedBuildingAreaClipped);
  print('Clipped Affected Agricultural Area (Ha):', affectedAgriculturalAreaClipped);
  print('Clipped Water Bodies Area (Ha):', waterAreaClipped);
  print('Clipped Flood Inundation Area (Ha):', floodAreaClipped);
  
  // Set export parameters
  var exportScale = 100; // Adjust scale as needed
  var region = ee.FeatureCollection('projects/ee-kayodeesther12345/assets/Borno_Admin_Boundaries_OnlyBorno_eHA_IOM_LGAs'); // Define your region
  
  // Common export parameters
  var commonExportParams = {
    scale: exportScale,
    region: region,
    fileFormat: 'GeoTIFF',
    formatOptions: {
      cloudOptimized: true // Enable cloud-optimized GeoTIFF
    },
    crs: 'EPSG:4326'
  };
  
  // Export Clipped Affected Buildings
  Export.image.toDrive({
    image: affectedBuildingsClipped,
    description: 'Clipped_Affected_Buildings',
    scale: commonExportParams.scale,
    region: commonExportParams.region,
    fileFormat: commonExportParams.fileFormat,
    formatOptions: commonExportParams.formatOptions,
    crs: commonExportParams.crs
  });
  
  // Export Clipped Affected Agricultural Areas
  Export.image.toDrive({
    image: affectedAgriculturalAreasClipped,
    description: 'Clipped_Affected_Agricultural_Areas',
    scale: commonExportParams.scale,
    region: commonExportParams.region,
    fileFormat: commonExportParams.fileFormat,
    formatOptions: commonExportParams.formatOptions,
    crs: commonExportParams.crs
  });
  
  // Export Clipped Water Bodies
  Export.image.toDrive({
    image: waterMaskClipped,
    description: 'Clipped_Water_Bodies',
    scale: commonExportParams.scale,
    region: commonExportParams.region,
    fileFormat: commonExportParams.fileFormat,
    formatOptions: commonExportParams.formatOptions,
    crs: commonExportParams.crs
  });
  
  // Export Clipped Flood Inundation
  Export.image.toDrive({
    image: floodInundationClipped,
    description: 'Clipped_Flood_Inundation',
    scale: commonExportParams.scale,
    region: commonExportParams.region,
    fileFormat: commonExportParams.fileFormat,
    formatOptions: commonExportParams.formatOptions,
    crs: commonExportParams.crs
  });
  