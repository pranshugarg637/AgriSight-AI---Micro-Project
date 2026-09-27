<#
  fetch_knowledge_base.ps1
  ------------------------
  Downloads free, publicly available crop-disease guides from university
  extension services into knowledge_base\documents, and writes a matching
  <file>.pdf.meta.json sidecar for each one so app/rag/metadata.py accepts
  them (real title / organization / source_url -- no placeholders).

  Run it from the project root:
      cd D:\MicroProject
      powershell -ExecutionPolicy Bypass -File scripts\fetch_knowledge_base.ps1

  Only files that download successfully AND are real PDFs get a sidecar.
  Anything that fails is reported at the end and simply skipped.

  These documents are published free by public universities for grower
  education. Check each source's terms before using them in anything
  public or commercial.
#>

param(
    [string]$OutDir = "knowledge_base\documents",
    [int]$TimeoutSec = 60
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

# name | url | title | organization | crop | disease
$Docs = @(
  # ---------------- TOMATO ----------------
  @{ n="tomato_late_blight_purdue";        u="https://www.extension.purdue.edu/extmedia/bp/bp-80-w.pdf";
     t="Late Blight of Tomato and Potato (BP-80-W)"; o="Purdue University Extension"; c="Tomato"; d="Late Blight" }
  @{ n="tomato_foliar_diseases_utk";       u="https://utia.tennessee.edu/publications/wp-content/uploads/sites/269/2023/10/SP277-W.pdf";
     t="Foliar Diseases of Tomato (SP 277-W)"; o="University of Tennessee Extension"; c="Tomato"; d="Foliar Diseases" }
  @{ n="tomato_leaf_fruit_diseases_ksu";   u="https://www1.maine.gov/dacf/php/gotpests/diseases/factsheets/tomato-diseases-kans.pdf";
     t="Tomato Leaf and Fruit Diseases and Disorders"; o="Kansas State University Cooperative Extension"; c="Tomato"; d="Leaf and Fruit Diseases" }
  @{ n="tomato_leaf_mold_cornell";         u="https://rvpadmin.cce.cornell.edu/uploads/doc_128.pdf";
     t="Leaf Mold in High Tunnel Tomatoes"; o="Cornell Cooperative Extension"; c="Tomato"; d="Leaf Mold" }
  @{ n="tomato_septoria_leaf_spot_wvu";    u="https://extension.wvu.edu/files/d/d688ba04-e529-4cb2-86c4-2dec525e7a29/septoria-leaf-spot.pdf";
     t="Septoria Leaf Spot: Management of this Recurring Disease on Tomato"; o="West Virginia University Extension Service"; c="Tomato"; d="Septoria Leaf Spot" }
  @{ n="tomato_early_blight_septoria_wisc"; u="https://barron.extension.wisc.edu/files/2023/02/Tomato-Disorder-Early-Blight-and-Septoria-Leaf-Spot.pdf";
     t="Tomato Disorders: Early Blight and Septoria Leaf Spot (A2606)"; o="University of Wisconsin-Madison Division of Extension"; c="Tomato"; d="Early Blight; Septoria Leaf Spot" }
  @{ n="tomato_early_blight_septoria_ksu"; u="https://hnr.k-state.edu/extension/horticulture-resource-center/common-pest-problems/documents/Tomato%20-%20Early%20Blight%20and%20Septoria%20Leaf%20Spot.pdf";
     t="Tomato: Early Blight and Septoria Leaf Spot"; o="Kansas State University Research and Extension"; c="Tomato"; d="Early Blight; Septoria Leaf Spot" }
  @{ n="tomato_potato_late_blight_cornell"; u="https://bpb-us-e1.wpmucdn.com/blogs.cornell.edu/dist/1/7446/files/2020/04/late-blight_factsheet.pdf";
     t="Tomato and Potato Late Blight Factsheet"; o="Cornell Cooperative Extension"; c="Tomato; Potato"; d="Late Blight" }
  @{ n="vegetable_diseases_purdue";        u="https://www.extension.purdue.edu/extmedia/bp/bp-184-w.pdf";
     t="Vegetable Diseases: Bacterial Spot of Tomato and Pepper (BP-184-W)"; o="Purdue University Extension"; c="Tomato; Pepper"; d="Bacterial Spot" }

  # ---------------- POTATO ----------------
  @{ n="potato_late_blight_wisc";          u="https://barron.extension.wisc.edu/files/2023/02/Potato-Late-Blight.pdf";
     t="Potato Late Blight: Identification and Management (A4052-02)"; o="University of Wisconsin-Madison Division of Extension"; c="Potato"; d="Late Blight" }
  @{ n="potato_diseases_home_garden_ndsu"; u="https://www.ag.ndsu.edu/potatoextension/Mgmtofpotatodiseasesinhomegarden.pdf";
     t="Management of Potato Diseases in the Home Garden"; o="North Dakota State University Extension"; c="Potato"; d="General Potato Diseases" }

  # ---------------- CORN / MAIZE ----------------
  @{ n="corn_northern_leaf_blight_purdue"; u="https://www.extension.purdue.edu/extmedia/bp/bp-84-w.pdf";
     t="Northern Corn Leaf Blight (BP-84-W)"; o="Purdue University Extension"; c="Corn"; d="Northern Leaf Blight" }
  @{ n="corn_gray_leaf_spot_purdue";       u="https://www.extension.purdue.edu/extmedia/bp/bp-56-w.pdf";
     t="Gray Leaf Spot (BP-56-W)"; o="Purdue University Extension"; c="Corn"; d="Gray Leaf Spot" }
  @{ n="corn_gray_leaf_spot_ksu";          u="https://www.plantpath.k-state.edu/extension/field-crops/documents/corn/grey-leaf-spot-corn-mf2341.pdf";
     t="Gray Leaf Spot of Corn (MF2341)"; o="Kansas State University Cooperative Extension"; c="Corn"; d="Gray Leaf Spot" }
  @{ n="corn_diseases_missouri";           u="https://extension.missouri.edu/sites/default/files/legacy_media/wysiwyg/Extensiondata/Pub/pdf/agguides/pests/ipm1001.pdf";
     t="Integrated Pest Management: Corn Diseases (IPM1001)"; o="University of Missouri Extension"; c="Corn"; d="General Corn Diseases" }
  @{ n="corn_diseases_arkansas";           u="https://www.uaex.uada.edu/publications/pdf/mp437/chapter7corn.pdf";
     t="Arkansas Corn Production Handbook, Chapter 7: Corn Diseases"; o="University of Arkansas Division of Agriculture"; c="Corn"; d="General Corn Diseases" }
  @{ n="corn_northern_leaf_blight_unl";    u="https://extensionpubs.unl.edu/publication/g2270/2016/pdf/view/g2270-2016.pdf";
     t="Northern Corn Leaf Blight (G2270)"; o="University of Nebraska-Lincoln Extension"; c="Corn"; d="Northern Leaf Blight" }

  # ---------------- APPLE ----------------
  @{ n="apple_scab_purdue";                u="https://www.extension.purdue.edu/extmedia/bp/bp-1-w.pdf";
     t="Apple Scab on Tree Fruit (BP-1-W)"; o="Purdue University Extension"; c="Apple"; d="Apple Scab" }
  @{ n="apple_rust_diseases_uky";          u="https://plantpathology.mgcafe.uky.edu/files/ppfs-fr-t-05.pdf";
     t="Apple Rust Diseases (PPFS-FR-T-05)"; o="University of Kentucky College of Agriculture Plant Pathology Extension"; c="Apple"; d="Cedar Apple Rust" }
  @{ n="apple_disease_management_uky";     u="https://plantpathology.mgcafe.uky.edu/files/ppfs-fr-t-18.pdf";
     t="Apple Disease Management (PPFS-FR-T-18)"; o="University of Kentucky College of Agriculture Plant Pathology Extension"; c="Apple"; d="General Apple Diseases" }
  @{ n="apple_disease_resistance_uky";     u="https://plantpathology.mgcafe.uky.edu/files/ppfs-fr-t-28.pdf";
     t="Disease Susceptibility and Resistance in Apple (PPFS-FR-T-28)"; o="University of Kentucky College of Agriculture Plant Pathology Extension"; c="Apple"; d="Disease Resistance" }
  @{ n="apple_disease_susceptibility_purdue"; u="https://www.extension.purdue.edu/extmedia/bp/bp-132-w.pdf";
     t="Disease Susceptibility of Common Apple Cultivars (BP-132-W)"; o="Purdue University Extension"; c="Apple"; d="Disease Susceptibility" }

  # ---------------- GRAPE ----------------
  @{ n="grape_black_rot_vt";               u="https://www.arec.vaes.vt.edu/content/dam/arec_vaes_vt_edu/alson-h-smith/grapes/pathology/extension/factsheets/black-rot.pdf";
     t="Online Guide to Grapevine Diseases: Black Rot"; o="Virginia Tech Alson H. Smith Jr. AREC"; c="Grape"; d="Black Rot" }
  @{ n="grape_powdery_mildew_vt";          u="https://www.arec.vaes.vt.edu/content/dam/arec_vaes_vt_edu/alson-h-smith/grapes/pathology/extension/factsheets/powdery_mildew.pdf";
     t="Online Guide to Grapevine Diseases: Powdery Mildew of Grapes"; o="Virginia Tech Alson H. Smith Jr. AREC"; c="Grape"; d="Powdery Mildew" }
  @{ n="grape_downy_mildew_vt";            u="https://www.arec.vaes.vt.edu/content/dam/arec_vaes_vt_edu/alson-h-smith/grapes/pathology/extension/factsheets/downy-mildew-grapevines.pdf";
     t="Online Guide to Grapevine Diseases: Downy Mildew of Grape"; o="Virginia Tech Alson H. Smith Jr. AREC"; c="Grape"; d="Downy Mildew" }
  @{ n="grape_downy_mildew_osu";           u="https://ohiograpeweb.cfaes.ohio-state.edu/sites/grapeweb/files/imce/pdf_factsheets/Downy%20Mildew.pdf";
     t="Downy Mildew of Grape"; o="The Ohio State University Extension"; c="Grape"; d="Downy Mildew" }

  # ---------------- CITRUS / ORANGE ----------------
  @{ n="citrus_huanglongbing_hawaii";      u="https://www3.ctahr.hawaii.edu/oc/freepubs/pdf/PD-112.pdf";
     t="Citrus Huanglongbing (PD-112)"; o="University of Hawai'i at Manoa College of Tropical Agriculture and Human Resources"; c="Citrus"; d="Huanglongbing (Citrus Greening)" }
  @{ n="citrus_huanglongbing_arizona";     u="https://extension.arizona.edu/sites/default/files/2024-08/az1795-2019.pdf";
     t="Huanglongbing of Citrus (AZ1795)"; o="The University of Arizona Cooperative Extension"; c="Citrus"; d="Huanglongbing (Citrus Greening)" }
  @{ n="citrus_greening_pacificpests";     u="https://apps.lucidcentral.org/pppw_v13/pdf/web_mini/citrus_huanglongbing_greening_230.pdf";
     t="Citrus Huanglongbing (Greening) - Fact Sheet 230"; o="Pacific Pests, Pathogens and Weeds (ACIAR)"; c="Citrus"; d="Huanglongbing (Citrus Greening)" }
  @{ n="citrus_greening_field_guide_uog";  u="https://www.uog.edu/_resources/files/extension/publications/Citrus_Greening.pdf";
     t="Citrus Greening (Huanglongbing): A Field Guide to Identification"; o="University of Guam Cooperative Extension"; c="Citrus"; d="Huanglongbing (Citrus Greening)" }

  # ---------------- STRAWBERRY ----------------
  @{ n="strawberry_common_leaf_spot_wisc"; u="https://pddc.wisc.edu/wp-content/blogs.dir/39/files/Fact_Sheets/FC_PDF/Common_Leaf_Spot_of_Strawberry.pdf";
     t="Common Leaf Spot of Strawberry (XHT1243)"; o="University of Wisconsin-Madison Division of Extension"; c="Strawberry"; d="Common Leaf Spot" }
  @{ n="strawberry_leaf_diseases_illinois"; u="https://ipm.illinois.edu/diseases/rpds/702.pdf";
     t="Strawberry Leaf Diseases (RPD No. 702)"; o="University of Illinois Extension"; c="Strawberry"; d="Leaf Scorch; Leaf Spot" }
  @{ n="strawberry_leaf_diseases_cornell"; u="https://cpb-us-e1.wpmucdn.com/blogs.cornell.edu/dist/0/7265/files/2017/01/strleafdisidmgmt-yjcu5n.pdf";
     t="Strawberry Leaf Diseases: Identification and Management"; o="Cornell Cooperative Extension"; c="Strawberry"; d="Leaf Scorch; Leaf Spot" }

  # ---------------- PEACH / CHERRY ----------------
  @{ n="peach_bacterial_spot_auburn";      u="https://www.aces.edu/wp-content/uploads/2025/03/ANR-2962_BacterialSpotTreatmentinPeaches_081925L.pdf";
     t="Bacterial Spot Treatment in Peaches (ANR-2962)"; o="Alabama Cooperative Extension System"; c="Peach"; d="Bacterial Spot" }
  @{ n="peach_bacterial_spot_ksu";         u="https://hnr.k-state.edu/extension/horticulture-resource-center/common-pest-problems/documents/Bacterial%20Spot%20on%20Fruit%20Trees.pdf";
     t="Bacterial Spot of Peach (Xanthomonas campestris pv. pruni)"; o="Kansas State University Research and Extension"; c="Peach"; d="Bacterial Spot" }
  @{ n="tree_fruit_disease_guide_purdue";  u="https://www.extension.purdue.edu/extmedia/id/id-146.pdf";
     t="Managing Pests in Home Fruit Plantings (ID-146)"; o="Purdue University Extension"; c="Apple; Peach; Cherry"; d="General Tree Fruit Diseases" }

  # ---------------- SQUASH / CUCURBITS ----------------
  @{ n="squash_pumpkin_diseases_okstate"; u="https://extension.okstate.edu/fact-sheets/print-publications/epp-entomology-and-plant-pathologhy/pumpkin-and-squash-diseases-epp-7336.pdf";
     t="Pumpkin and Squash Diseases (EPP-7336)"; o="Oklahoma Cooperative Extension Service"; c="Squash"; d="General Squash Diseases" }
  @{ n="powdery_mildew_vegetables_hawaii"; u="https://www3.ctahr.hawaii.edu/oc/freepubs/pdf/PD-98.pdf";
     t="Powdery Mildew of Garden Vegetables (PD-98)"; o="University of Hawai'i at Manoa College of Tropical Agriculture and Human Resources"; c="Squash; Pepper"; d="Powdery Mildew" }
  @{ n="cucurbit_disease_scouting_umass"; u="https://www.umass.edu/agriculture-food-environment/sites/ag.umass.edu/files/pdf-doc-ppt/using_ipm_in_the_field_-_cucurbit_disease_scouting_and_management_guide.pdf";
     t="Using IPM in the Field: Cucurbit Disease Scouting and Management Guide"; o="University of Massachusetts Amherst Extension"; c="Squash"; d="General Cucurbit Diseases" }

  # ---------------- SOYBEAN ----------------
  @{ n="soybean_diseases_missouri";        u="https://extension.missouri.edu/media/wysiwyg/Extensiondata/Pub/pdf/agguides/pests/ipm1002.pdf";
     t="Integrated Pest Management: Soybean Diseases (IPM1002)"; o="University of Missouri Extension"; c="Soybean"; d="General Soybean Diseases" }
  @{ n="soybean_diseases_arkansas";        u="https://www.uaex.uada.edu/publications/pdf/mp197/chapter11.pdf";
     t="Arkansas Soybean Production Handbook, Chapter 11: Soybean Diseases"; o="University of Arkansas Division of Agriculture"; c="Soybean"; d="General Soybean Diseases" }
)

# ---------------------------------------------------------------------------

if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
    Write-Host "Created $OutDir"
}

$ok = @(); $bad = @(); $i = 0

Write-Host ""
Write-Host "Downloading $($Docs.Count) documents into $OutDir ..." -ForegroundColor Cyan
Write-Host ""

foreach ($doc in $Docs) {
    $i++
    $pdf = Join-Path $OutDir "$($doc.n).pdf"
    $label = "[{0,2}/{1}] {2}" -f $i, $Docs.Count, $doc.n
    try {
        Invoke-WebRequest -Uri $doc.u -OutFile $pdf -UserAgent $UA `
            -TimeoutSec $TimeoutSec -MaximumRedirection 5 -ErrorAction Stop | Out-Null

        # Confirm it is really a PDF and not an error page saved as .pdf
        $head = [System.IO.File]::ReadAllBytes($pdf)[0..3] -as [byte[]]
        $magic = -join ($head | ForEach-Object { [char]$_ })
        $size  = (Get-Item $pdf).Length

        if ($magic -ne "%PDF" -or $size -lt 5000) {
            Remove-Item $pdf -Force
            throw "not a valid PDF (magic='$magic', ${size} bytes)"
        }

        # Sidecar metadata -- real values, so metadata.py accepts it
        $meta = [ordered]@{
            title         = $doc.t
            organization  = $doc.o
            crop          = $doc.c
            disease       = $doc.d
            source_url    = $doc.u
            document_type = "extension_guide"
            retrieved     = (Get-Date -Format "yyyy-MM-dd")
        }
        $meta | ConvertTo-Json -Depth 3 |
            Set-Content -Path "$pdf.meta.json" -Encoding UTF8

        $kb = [math]::Round($size / 1KB)
        Write-Host "$label  OK  (${kb} KB)" -ForegroundColor Green
        $ok += $doc.n
    }
    catch {
        Write-Host "$label  FAILED  $($_.Exception.Message)" -ForegroundColor Yellow
        $bad += [pscustomobject]@{ Name = $doc.n; Url = $doc.u; Reason = $_.Exception.Message }
    }
}

Write-Host ""
Write-Host ("-" * 60)
Write-Host "Downloaded : $($ok.Count)" -ForegroundColor Green
Write-Host "Failed     : $($bad.Count)" -ForegroundColor $(if ($bad.Count) { "Yellow" } else { "Green" })

if ($bad.Count) {
    Write-Host ""
    Write-Host "These did not download (site moved, blocked, or offline):"
    $bad | ForEach-Object { Write-Host "  - $($_.Name): $($_.Reason)" }
    Write-Host ""
    Write-Host "You can open their URLs in a browser and save the PDF manually"
    Write-Host "into $OutDir if you want them."
}

Write-Host ""
Write-Host "Next step -- build the search index:" -ForegroundColor Cyan
Write-Host '  cd ml-service'
Write-Host '  $env:KNOWLEDGE_BASE_PATH = "..\knowledge_base\documents"'
Write-Host '  .venv\Scripts\python.exe -m app.rag.ingest --rebuild'
Write-Host ""
