// lib/generateDeliveryChallan.js
// Generates Delivery Challan PDF matching the exact format

import jsPDF from 'jspdf'
import 'jspdf-autotable'

/**
 * Convert number to words (Indian numbering system)
 */
function numberToWords(num) {
  const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE']
  const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY']
  const teens = ['TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN']

  if (num === 0) return 'ZERO'

  function convertLessThanThousand(n) {
    if (n === 0) return ''
    if (n < 10) return ones[n]
    if (n < 20) return teens[n - 10]
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '')
    return ones[Math.floor(n / 100)] + ' HUNDRED' + (n % 100 ? ' ' + convertLessThanThousand(n % 100) : '')
  }

  if (num < 1000) return convertLessThanThousand(num)
  if (num < 100000) { // Thousands
    return convertLessThanThousand(Math.floor(num / 1000)) + ' THOUSAND' + (num % 1000 ? ' ' + convertLessThanThousand(num % 1000) : '')
  }
  if (num < 10000000) { // Lakhs
    return convertLessThanThousand(Math.floor(num / 100000)) + ' LAC' + (num % 100000 ? ' ' + numberToWords(num % 100000) : '')
  }
  // Crores
  return convertLessThanThousand(Math.floor(num / 10000000)) + ' CRORE' + (num % 10000000 ? ' ' + numberToWords(num % 10000000) : '')
}

/**
 * Generate Delivery Challan PDF
 * @param {Object} data - Consignment and related data
 * @returns {jsPDF} PDF document
 */
export function generateDeliveryChallan(data) {
  const {
    consignment,
    branch,
    companySettings,
    items, // array of purchase items
  } = data

  const doc = new jsPDF('p', 'mm', 'a4')
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  // Colors
  const primaryBlue = [0, 51, 153]
  const borderGray = [100, 100, 100]
  const textBlack = [0, 0, 0]

  let yPos = 10

  // ========== HEADER SECTION ==========
  // Top border
  doc.setDrawColor(...primaryBlue)
  doc.setLineWidth(0.5)
  doc.rect(10, yPos, pageWidth - 20, 25)

  // Logo section (left) - placeholder for now
  doc.setFillColor(...primaryBlue)
  doc.rect(10, yPos, 40, 25, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('WHITE', 15, yPos + 10)
  doc.text('GOLD', 15, yPos + 18)

  // Title (center)
  doc.setTextColor(...textBlack)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('DELIVERY CHALLAN/ISSUE VOUCHER', pageWidth / 2, yPos + 8, { align: 'center' })

  // Labels (right)
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.text('ORIGINAL FOR CONSIGNEE', pageWidth - 15, yPos + 5, { align: 'right' })
  doc.text('DUPLICATE FOR TRANSPORTER', pageWidth - 15, yPos + 10, { align: 'right' })
  doc.text('TRIPLICATE FOR CONSIGNOR', pageWidth - 15, yPos + 15, { align: 'right' })

  // TMP PRF No (red, prominent)
  doc.setTextColor(255, 0, 0)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text(`TAMPER PROOF No:- ${consignment.tmp_prf_no}`, pageWidth / 2, yPos + 15, { align: 'center' })

  // Reference text
  doc.setTextColor(...borderGray)
  doc.setFontSize(6)
  doc.setFont('helvetica', 'normal')
  doc.text('(REFER RULE 55 TO CGST ACT)', pageWidth / 2, yPos + 20, { align: 'center' })

  yPos += 27

  // ========== DELIVERY CHALLAN INFO ==========
  doc.setTextColor(...textBlack)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')

  const leftCol = 15
  const midCol = 110
  const rightCol = 150

  // Left column
  doc.text('DELIVERY CHALLAN NO', leftCol, yPos)
  doc.text('DELIVERY CHALLAN DATE', leftCol, yPos + 5)
  doc.text('STATE', leftCol, yPos + 10)
  doc.text('STATE CODE', leftCol, yPos + 15)

  doc.setFont('helvetica', 'normal')
  doc.text(`: ${consignment.challan_no}`, leftCol + 50, yPos)
  doc.text(`: ${new Date(consignment.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase().replace(/ /g, '-')}`, leftCol + 50, yPos + 5)
  doc.text(`: ${branch.state?.toUpperCase() || 'KARNATAKA'}`, leftCol + 50, yPos + 10)
  doc.text(`: ${consignment.state_code || '29'}`, leftCol + 50, yPos + 15)

  // Right column
  doc.setFont('helvetica', 'bold')
  doc.text('TRANSPORTER NAME', midCol, yPos)
  doc.text('TRANSPORTATION MODE', midCol, yPos + 5)
  doc.text('PLACE OF SUPPLY', midCol, yPos + 10)
  doc.text('VEHICLE NO.', midCol, yPos + 15)

  doc.setFont('helvetica', 'normal')
  doc.text(`: ${companySettings.transporter_name || 'BVC LOGISTICS PVT. LTD.'}`, midCol + 48, yPos)
  doc.text(`: ${companySettings.transportation_mode || 'BY AIR & ROAD'}`, midCol + 48, yPos + 5)
  doc.text(`: ${branch.state?.toUpperCase() || 'KARNATAKA'}`, midCol + 48, yPos + 10)
  doc.text(`:`, midCol + 48, yPos + 15)

  yPos += 22

  // ========== BILL FROM SECTION ==========
  doc.setDrawColor(...borderGray)
  doc.setLineWidth(0.3)
  doc.rect(10, yPos, pageWidth - 20, 35)

  // Draw vertical divider
  doc.line(pageWidth / 2, yPos, pageWidth / 2, yPos + 35)

  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('BILL FROM', leftCol, yPos + 5)
  doc.text('CONTACT PERSON', leftCol, yPos + 10)
  doc.text('ADDRESS', leftCol, yPos + 15)

  doc.setFont('helvetica', 'normal')
  doc.text(`: ${companySettings.company_name}`, leftCol + 30, yPos + 5)
  doc.text(`: ${branch.contact_person || ''} ${branch.contact_phone || ''}`, leftCol + 30, yPos + 10)

  // Address (multi-line)
  const addressLines = doc.splitTextToSize(`: ${branch.address || ''}, ${branch.city || ''}, ${branch.state || ''} ${branch.pin_code || ''}`, 85)
  doc.text(addressLines, leftCol + 30, yPos + 15)

  doc.setFont('helvetica', 'bold')
  doc.text('STATE CODE', leftCol, yPos + 28)
  doc.text('GSTIN', leftCol, yPos + 32)

  doc.setFont('helvetica', 'normal')
  doc.text(`: ${consignment.state_code || '29'}`, leftCol + 30, yPos + 28)
  doc.text(`: ${branch.branch_gstin || branch.gstin || companySettings.gstin}`, leftCol + 30, yPos + 32)

  // Right side - CONSIGNEE ADDRESS
  doc.setFont('helvetica', 'bold')
  doc.text('CONSIGNEE ADDRESS:', midCol, yPos + 5)

  doc.setFont('helvetica', 'normal')
  const consigneeAddr = doc.splitTextToSize(
    `${companySettings.company_name}-BENGALURU\n${companySettings.head_office_address || ''}\n${companySettings.head_office_city || ''}, ${companySettings.head_office_state || ''}-${companySettings.head_office_pin || ''}`,
    85
  )
  doc.text(consigneeAddr, midCol, yPos + 10)

  doc.setFont('helvetica', 'bold')
  doc.text('STATE', midCol, yPos + 25)
  doc.text('STATE CODE', midCol, yPos + 29)
  doc.text('GSTIN', midCol, yPos + 33)

  doc.setFont('helvetica', 'normal')
  doc.text(`: ${companySettings.head_office_state || 'KARNATAKA'}`, midCol + 20, yPos + 25)
  doc.text(`: 29`, midCol + 20, yPos + 29)
  doc.text(`: ${companySettings.gstin}`, midCol + 20, yPos + 33)

  yPos += 37

  // ========== PURPOSE SECTION ==========
  doc.rect(10, yPos, pageWidth - 20, 10)
  doc.setFont('helvetica', 'bold')
  doc.text('PURPOSE OF MOVEMENT', leftCol, yPos + 5)
  doc.setFont('helvetica', 'normal')
  doc.text(`: STOCK TRANSFER`, leftCol + 50, yPos + 5)

  doc.setFont('helvetica', 'bold')
  doc.text('PAN/AADHAR', midCol + 10, yPos + 5)
  doc.setFont('helvetica', 'normal')
  doc.text(`: ${companySettings.pan || ''}`, midCol + 30, yPos + 5)

  yPos += 12

  // ========== ITEMS TABLE ==========
  const totalNetWt = items.reduce((sum, item) => sum + parseFloat(item.net_weight || 0), 0)
  const totalAmount = items.reduce((sum, item) => sum + parseFloat(item.total_amount || 0), 0)
  const rate = totalNetWt > 0 ? (totalAmount / totalNetWt).toFixed(2) : 0

  doc.autoTable({
    startY: yPos,
    head: [[
      'S.No.',
      'DESCRIPTION OF GOODS',
      'HSN OF GOODS',
      'QUANTITY/GROSS\nWEIGHT (GMS)',
      'RATE',
      'VALUE OF GOODS'
    ]],
    body: [[
      '1',
      `USED GOLD ORNAMENTS-${branch.state?.toUpperCase().slice(0, 2) || 'KA'}`,
      companySettings.hsn_code || '711319',
      totalNetWt.toFixed(2),
      parseFloat(rate).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    ]],
    foot: [[
      '',
      '',
      '',
      '',
      'GRAND TOTAL',
      totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    ]],
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 3, lineColor: borderGray, lineWidth: 0.3 },
    headStyles: { fillColor: [240, 240, 240], textColor: textBlack, fontStyle: 'bold', halign: 'center' },
    footStyles: { fillColor: [255, 255, 255], textColor: textBlack, fontStyle: 'bold' },
    columnStyles: {
      0: { halign: 'center', cellWidth: 15 },
      1: { halign: 'left', cellWidth: 60 },
      2: { halign: 'center', cellWidth: 25 },
      3: { halign: 'right', cellWidth: 30 },
      4: { halign: 'right', cellWidth: 30 },
      5: { halign: 'right', cellWidth: 35 }
    },
    margin: { left: 10, right: 10 }
  })

  yPos = doc.lastAutoTable.finalY + 2

  // TOTAL IN WORDS
  doc.rect(10, yPos, pageWidth - 20, 10)
  doc.setFont('helvetica', 'bold')
  doc.text('TOTAL VALUE IN WORDS :', leftCol, yPos + 5)
  doc.setFont('helvetica', 'normal')
  const amountInWords = numberToWords(Math.round(totalAmount))
  doc.text(`RUPEES ${amountInWords} ONLY`, leftCol + 45, yPos + 5)

  yPos += 12

  // ========== SIGNATURES SECTION ==========
  doc.rect(10, yPos, (pageWidth - 20) / 2, 20)
  doc.rect(pageWidth / 2, yPos, (pageWidth - 20) / 2, 20)

  doc.setFont('helvetica', 'normal')
  doc.text("Receiver's Signature", leftCol, yPos + 15)
  doc.text("Stamp & Signature of supplier/ authorised representative", midCol + 10, yPos + 15)

  return doc
}
